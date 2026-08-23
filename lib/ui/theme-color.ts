export const defaultThemeColor = "#b9472f";

export function isThemeColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function themeColorContrastOnWhite(value: string) {
  if (!isThemeColor(value)) return 0;
  return contrastRatio(relativeLuminance(value), 1);
}

export function isAccessibleThemeColor(value: string) {
  return themeColorContrastOnWhite(value) >= 4.5;
}

export function themeColorContent(value: string) {
  const luminance = relativeLuminance(value);
  return contrastRatio(luminance, 1) >= contrastRatio(luminance, 0) ? "#ffffff" : "#20242a";
}

function relativeLuminance(value: string) {
  const channels = [1, 3, 5].map(
    (index) => Number.parseInt(value.slice(index, index + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(left: number, right: number) {
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}
