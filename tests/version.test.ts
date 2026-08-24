import { describe, expect, it } from "vitest";
import packageMetadata from "../package.json";
import { appVersion, compareVersions, latestStableVersion, normalizeVersion } from "../lib/version";

describe("application versions", () => {
  it("keeps the displayed version aligned with the package version", () => {
    expect(appVersion).toBe(packageMetadata.version);
  });

  it("normalizes complete stable version tags", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeVersion("1.02.003")).toBe("1.2.3");
    expect(normalizeVersion("v1.2")).toBeNull();
    expect(normalizeVersion("v1.2.3-beta.1")).toBeNull();
  });

  it("compares numeric version components", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("v2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.0.2", "v1.0.2")).toBe(0);
  });

  it("finds the newest complete stable version", () => {
    expect(latestStableVersion(["v1.0.0", "v1.2.0", "sha-deadbee", "v1.1.9"])).toBe("1.2.0");
  });
});
