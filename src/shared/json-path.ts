export interface JsonPathResult {
  found: boolean;
  value?: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readJsonPath(root: unknown, path: string): JsonPathResult {
  let current = root;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

export function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
