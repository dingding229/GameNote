export const appVersion = "1.0.13";

export function normalizeVersion(value: string) {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts.join(".");
}

export function compareVersions(left: string, right: string) {
  const normalizedLeft = normalizeVersion(left);
  const normalizedRight = normalizeVersion(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  const leftParts = normalizedLeft.split(".").map(Number);
  const rightParts = normalizedRight.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

export function latestStableVersion(values: string[]) {
  return (
    values
      .map(normalizeVersion)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => compareVersions(right, left))[0] ?? null
  );
}
