type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

function readArg(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;

  return null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function normalizeBaseUrl(raw: string): URL {
  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function buildUrl(baseUrl: URL, path: string): string {
  return new URL(path, baseUrl).toString();
}

async function check(
  results: CheckResult[],
  name: string,
  run: () => Promise<string | false>
): Promise<void> {
  try {
    const detail = await run();
    results.push({
      name,
      ok: detail !== false,
      detail: detail === false ? "failed" : detail
    });
  } catch (error) {
    results.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

function expectHeader(
  response: Response,
  header: string,
  predicate: (value: string | null) => boolean,
  expected: string
): string | false {
  const value = response.headers.get(header);
  if (!predicate(value)) {
    return false;
  }

  return `${header}=${value ?? "(absent)"} (${expected})`;
}

async function main(): Promise<void> {
  const baseUrl = normalizeBaseUrl(
    readArg("--base-url") ||
      process.env["PROD_SECURITY_SMOKE_BASE_URL"] ||
      process.env["PUBLIC_BASE_URL"] ||
      "https://hachozeh.com"
  );
  const allowHttp = hasFlag("--allow-http");
  const results: CheckResult[] = [];

  await check(results, "public URL uses HTTPS", async () => {
    if (baseUrl.protocol !== "https:" && !allowHttp) {
      return false;
    }

    return baseUrl.toString();
  });

  await check(results, "shell has security headers", async () => {
    const response = await fetch(buildUrl(baseUrl, "/trending"), {
      headers: { accept: "text/html" },
      redirect: "manual"
    });

    if (response.status < 200 || response.status >= 400) {
      return `unexpected status=${response.status}`;
    }

    const checks = [
      expectHeader(response, "x-frame-options", (value) => value === "DENY", "DENY"),
      expectHeader(response, "x-content-type-options", (value) => value === "nosniff", "nosniff"),
      expectHeader(response, "content-security-policy", (value) => Boolean(value?.includes("frame-ancestors 'none'")), "CSP with frame-ancestors")
    ];

    if (baseUrl.protocol === "https:") {
      checks.push(expectHeader(response, "strict-transport-security", (value) => Boolean(value), "present on HTTPS"));
    }

    const failed = checks.find((item) => item === false);
    if (failed === false) {
      return false;
    }

    return `status=${response.status}; ${checks.join("; ")}`;
  });

  await check(results, "guest /api/me rejects with no-store", async () => {
    const response = await fetch(buildUrl(baseUrl, "/api/me"), {
      headers: { accept: "application/json" }
    });
    const cacheControl = response.headers.get("cache-control");

    if (response.status !== 401 || cacheControl !== "no-store") {
      return `status=${response.status}; cache-control=${cacheControl ?? "(absent)"}`;
    }

    return `status=401; cache-control=${cacheControl}`;
  });

  await check(results, "session read is anonymous and read-limited", async () => {
    const response = await fetch(buildUrl(baseUrl, "/api/session"), {
      headers: { accept: "application/json" }
    });
    const payload = await response.json().catch(() => null);
    const family = response.headers.get("x-rate-limit-family");

    if (
      response.status !== 200 ||
      payload?.session?.authenticated !== false ||
      family !== "session_read"
    ) {
      return `status=${response.status}; authenticated=${String(payload?.session?.authenticated)}; family=${family ?? "(absent)"}`;
    }

    return `status=200; authenticated=false; family=${family}`;
  });

  await check(results, "untrusted CORS origin is not allowed", async () => {
    const response = await fetch(buildUrl(baseUrl, "/api/me"), {
      headers: {
        accept: "application/json",
        origin: "https://evil.example"
      }
    });
    const allowOrigin = response.headers.get("access-control-allow-origin");
    const allowCredentials = response.headers.get("access-control-allow-credentials");

    if (allowOrigin || allowCredentials) {
      return `acao=${allowOrigin ?? "(absent)"}; acac=${allowCredentials ?? "(absent)"}`;
    }

    return "no ACAO/ACAC for evil origin";
  });

  await check(results, "unknown API path is bounded", async () => {
    const response = await fetch(buildUrl(baseUrl, "/api/security-smoke-not-real"), {
      headers: { accept: "application/json" }
    });
    const family = response.headers.get("x-rate-limit-family");

    if (response.status !== 404 || family !== "general_request") {
      return `status=${response.status}; family=${family ?? "(absent)"}`;
    }

    return `status=404; family=${family}`;
  });

  for (const result of results) {
    const marker = result.ok ? "ok" : "fail";
    console.log(`${marker}\t${result.name}\t${result.detail}`);
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
