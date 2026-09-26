import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { RESERVED_HANDLES } from "../../src/auth/current-user-profile-service";

const PAGES_DIR = resolve(process.cwd(), "../web/src/pages");

function normalizeRouteName(segment: string): string | null {
  if (segment === "index.astro" || segment.startsWith("[")) return null;

  return segment
    .replace(/\.(astro|js|ts)$/, "")
    .replace(/\.(html|xml|txt)$/, "");
}

async function readTopLevelRouteNames(): Promise<string[]> {
  const entries = await readdir(PAGES_DIR, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() || /\.(astro|js|ts)$/.test(entry.name))
    .map((entry) => normalizeRouteName(entry.name))
    .filter((name): name is string => Boolean(name));

  return [...new Set(names)].sort();
}

describe("public handle reserved words", () => {
  it("reserves every static top-level web route", async () => {
    const routeNames = await readTopLevelRouteNames();
    const missing = routeNames.filter((name) => !RESERVED_HANDLES.has(name));

    expect(missing).toEqual([]);
  });

  it("reserves platform and operator impersonation handles", () => {
    expect([...RESERVED_HANDLES]).toEqual(expect.arrayContaining([
      "hachozeh",
      "operator",
      "oracle",
      "seer",
      "support",
      "system"
    ]));
  });
});
