const baseUrl = process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001";
const targets = ["/health/live", "/health/ready"];

async function run(): Promise<void> {
  for (const path of targets) {
    const response = await fetch(`${baseUrl}${path}`);
    const payload = await response.json();

    console.log(JSON.stringify({
      path,
      status: response.status,
      payload
    }));

    if (!response.ok) {
      throw new Error(`Health smoke failed for ${path}`);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export {};
