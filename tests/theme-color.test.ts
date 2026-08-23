import { describe, expect, it } from "vitest";
import {
  defaultThemeColor,
  isAccessibleThemeColor,
  themeColorContent,
  themeColorContrastOnWhite,
} from "../lib/ui/theme-color";

describe("theme color accessibility", () => {
  it("keeps the default color above WCAG AA contrast", () => {
    expect(themeColorContrastOnWhite(defaultThemeColor)).toBeGreaterThanOrEqual(4.5);
  });

  it("rejects the former low-contrast orange", () => {
    expect(isAccessibleThemeColor("#ef5b2a")).toBe(false);
  });

  it("selects readable button content", () => {
    expect(themeColorContent("#222222")).toBe("#ffffff");
    expect(themeColorContent("#fefefe")).toBe("#20242a");
  });
});
