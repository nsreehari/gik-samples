import type { Json } from "@gik-ai/kernel";

export interface HostQuery {
  /** The explicitly selected Blueprint, or `null` when nothing named one. `null` is never
   * substituted with the catalog's default Blueprint: it selects the host's application root. */
  targetId: string | null;
  durableEnabled: boolean;
  testsEnabled: boolean;
  scenariosEnabled: boolean;
  provisioningEnabled: boolean;
  externalContext?: Record<string, Json>;
}

function isInMemoryPath(pathname: string): boolean {
  return /(?:^|\/)in-memory(?:\/|$)/.test(pathname);
}

function isTestsPath(pathname: string): boolean {
  return /(?:^|\/)tests(?:\/index\.html)?\/?$/.test(pathname);
}

function isScenariosPath(pathname: string): boolean {
  return /(?:^|\/)scenarios(?:\/index\.html)?\/?$/.test(pathname);
}

function isProvisioningPath(pathname: string): boolean {
  return /(?:^|\/)provisioning(?:\/index\.html)?\/?$/.test(pathname);
}

function parseExternalContext(value: string | null): Record<string, Json> | undefined {
  if (value === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("Host context must be a URL-encoded JSON object.", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Host context must be a URL-encoded JSON object.");
  }
  return Object.keys(parsed).length === 0 ? undefined : parsed as Record<string, Json>;
}

function selectedBlueprintId(params: URLSearchParams): string | null {
  const value = params.get("b")?.trim();
  return value || null;
}

export function readHostQuery(search: string, pathname = "/"): HostQuery {
  const params = new URLSearchParams(search);
  const scenariosEnabled = isScenariosPath(pathname);
  const provisioningEnabled = isProvisioningPath(pathname);
  const externalContext = scenariosEnabled ? undefined : parseExternalContext(params.get("context"));
  return {
    targetId: selectedBlueprintId(params),
    durableEnabled: provisioningEnabled || !isInMemoryPath(pathname),
    testsEnabled: isTestsPath(pathname),
    scenariosEnabled,
    provisioningEnabled,
    ...(externalContext ? { externalContext } : {}),
  };
}

export function writeBlueprintQuery(href: string, blueprintId: string): string {
  const url = new URL(href);
  url.searchParams.set("b", blueprintId);
  url.searchParams.delete("scenario");
  url.searchParams.delete("context");
  return url.toString();
}

export function canonicalizeHostUrl(href: string): string {
  const url = new URL(href);
  const params = url.searchParams;

  url.pathname = url.pathname.replace(
    /\/in-memory\/provisioning(?:\/index\.html)?\/?$/,
    "/provisioning/",
  );
  if (params.has("b") && !params.get("b")?.trim()) params.delete("b");
  params.delete("durable");

  return url.toString();
}
