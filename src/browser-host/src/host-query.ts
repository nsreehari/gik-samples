import type { Json } from "@gik/kernel";

export interface HostQuery {
  /** The explicitly selected Blueprint, or `null` when nothing named one. `null` is never
   * substituted with the catalog's default Blueprint: it selects the host's application root. */
  targetId: string | null;
  durableEnabled: boolean;
  testsEnabled: boolean;
  scenariosEnabled: boolean;
  externalContext?: Record<string, Json>;
}

export interface ScenarioQuery {
  blueprintId?: string;
  scenarioId?: string;
  contextId?: string;
}

function isInMemoryPath(pathname: string): boolean {
  return /(?:^|\/)in-memory(?:\/index\.html)?\/?$/.test(pathname);
}

function isTestsPath(pathname: string): boolean {
  return /(?:^|\/)tests(?:\/index\.html)?\/?$/.test(pathname);
}

function isScenariosPath(pathname: string): boolean {
  return /(?:^|\/)scenarios(?:\/index\.html)?\/?$/.test(pathname);
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
  const externalContext = scenariosEnabled ? undefined : parseExternalContext(params.get("context"));
  return {
    targetId: selectedBlueprintId(params),
    durableEnabled: !isInMemoryPath(pathname),
    testsEnabled: isTestsPath(pathname),
    scenariosEnabled,
    ...(externalContext ? { externalContext } : {}),
  };
}

export function readScenarioQuery(search: string): ScenarioQuery {
  const params = new URLSearchParams(search);
  const read = (name: string) => params.get(name)?.trim() || undefined;
  return {
    ...(read("b") ? { blueprintId: read("b") } : {}),
    ...(read("scenario") ? { scenarioId: read("scenario") } : {}),
    ...(read("context") ? { contextId: read("context") } : {}),
  };
}

export function writeScenarioQuery(
  href: string,
  selection: Required<Pick<ScenarioQuery, "blueprintId" | "scenarioId">>
    & Pick<ScenarioQuery, "contextId">,
): string {
  const url = new URL(href);
  url.searchParams.set("b", selection.blueprintId);
  url.searchParams.set("scenario", selection.scenarioId);
  if (selection.contextId) url.searchParams.set("context", selection.contextId);
  else url.searchParams.delete("context");
  return url.toString();
}

export function canonicalizeHostUrl(href: string): string {
  const url = new URL(href);
  const params = url.searchParams;

  if (params.has("b") && !params.get("b")?.trim()) params.delete("b");
  params.delete("durable");

  return url.toString();
}
