import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { readMarketVisualRegistry } from "../../src/shared/market-visual-registry";

function resolveWebPublicAssetPath(publicPath: string): string {
  const repoRootPath = join(process.cwd(), "systems/web/public", publicPath.slice(1));
  const backendPackagePath = join(process.cwd(), "../web/public", publicPath.slice(1));

  return existsSync(repoRootPath) ? repoRootPath : backendPackagePath;
}

describe("market visual registry", () => {
  it("only exposes approved local bucket assets by default", () => {
    const registry = readMarketVisualRegistry();

    expect(registry.objectType).toBe("market_visual_asset_registry_v1");

    for (const asset of registry.assets) {
      expect(asset.path).toMatch(/^\/assets\/images\/market-buckets\/.+\.svg$/);
      expect(existsSync(resolveWebPublicAssetPath(asset.path))).toBe(true);
      expect(["hachozeh-owned", "approved-third-party"]).toContain(asset.rights.status);
      expect(asset.rights.publicUse).toBe("allowed");
      expect(asset.rights.owner).toEqual(expect.any(String));
      expect(asset.theme.primary).toMatch(/^#/);
      expect(asset.theme.secondary).toMatch(/^#/);
      expect(asset.theme.surface).toMatch(/^#/);
    }
  });
});
