export interface ServerPlan {
  planId: string;
  planDigest: string;
  expiresAt: string;
  actions: unknown[];
}

export function normalizeCompanionPort(value: string | number): number {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error("Companion port must be a whole number between 1 and 65535");
  }
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Companion port must be a whole number between 1 and 65535");
  }
  return port;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(value.error ?? `Companion request failed (${response.status})`));
  return value;
}

export class ProvisioningCompanionClient {
  readonly endpoint: string;
  #token = "";

  constructor(port: string | number) {
    this.endpoint = `http://127.0.0.1:${normalizeCompanionPort(port)}`;
  }

  get paired(): boolean {
    return Boolean(this.#token);
  }

  async pair(code: string): Promise<{ expiresAt: string }> {
    const response = await fetch(`${this.endpoint}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });
    const value = await responseJson(response);
    if (typeof value.bearerToken !== "string" || !value.bearerToken) {
      throw new Error("Companion pairing response did not include a bearer token");
    }
    this.#token = value.bearerToken;
    return { expiresAt: String(value.expiresAt ?? "") };
  }

  async operation<T>(name: string, input: unknown): Promise<T> {
    if (!this.#token) throw new Error("Pair with the local companion first");
    const response = await fetch(`${this.endpoint}/api/operations/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const value = await responseJson(response);
    return value.result as T;
  }
}
