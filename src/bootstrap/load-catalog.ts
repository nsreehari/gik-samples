import { parseBlueprintJson, type BlueprintArtifact } from "@gik/blueprint";
import type { Json } from "@gik/kernel";

import type {
  BlueprintCatalogBundle,
  BlueprintLaunchProfile,
} from "./catalog/blueprint-catalog";
import {
  parseBlueprintBootstrapAssets,
  type BlueprintBootstrapAssets,
} from "./catalog/blueprint-bootstrap-assets";
import { digestCatalog } from "./catalog/catalog-digest";
import {
  parseBlueprintTestDocument,
  type BlueprintTestDocument,
} from "../testing/declarative-blueprint-tests";
import {
  parseScenarioDocument,
  validateScenarioDocumentTarget,
} from "../scenarios/scenario-document";

type JsonRecord = Record<string, unknown>;

interface CatalogIndexEntry {
  id: string;
  artifact: string;
  bootstrapAssets?: string;
  scenarios?: string;
  tests?: string;
  launch?: Omit<BlueprintLaunchProfile, "blueprint">;
}

interface BootstrapCatalogIndex {
  format: "gik-bootstrap-catalog/1";
  id: string;
  defaultLaunch: string;
  entries: CatalogIndexEntry[];
}

type ReadBootstrapJson = (path: string) => Promise<unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Bootstrap catalog '${field}' must be a non-empty string.`);
  }
  return value;
}

function relativeJsonPath(value: unknown, field: string): string {
  const path = requiredString(value, field).replaceAll("\\", "/");
  if (path.startsWith("/") || path.split("/").includes("..") || !path.endsWith(".json")) {
    throw new Error(`Bootstrap catalog '${field}' must be a relative JSON path.`);
  }
  return path;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`Bootstrap catalog '${field}' must be an array of non-empty strings.`);
  }
  return [...new Set(value)];
}

function parseLaunch(value: unknown, entryId: string): Omit<BlueprintLaunchProfile, "blueprint"> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Bootstrap catalog launch for '${entryId}' is invalid.`);
  const order = value.order;
  if (order !== undefined && (typeof order !== "number" || !Number.isFinite(order))) {
    throw new Error(`Bootstrap catalog launch order for '${entryId}' is invalid.`);
  }
  if (value.context !== undefined && !isRecord(value.context)) {
    throw new Error(`Bootstrap catalog launch context for '${entryId}' is invalid.`);
  }
  return {
    id: requiredString(value.id, `entries.${entryId}.launch.id`),
    label: requiredString(value.label, `entries.${entryId}.launch.label`),
    ...(value.description === undefined
      ? {}
      : { description: requiredString(value.description, `entries.${entryId}.launch.description`) }),
    ...(order === undefined ? {} : { order }),
    ...(value.context === undefined ? {} : { context: structuredClone(value.context) as Record<string, Json> }),
    ...(value.requiredCapabilities === undefined
      ? {}
      : {
          requiredCapabilities: optionalStringArray(
            value.requiredCapabilities,
            `entries.${entryId}.launch.requiredCapabilities`,
          ),
        }),
  };
}

function parseBootstrapCatalogIndex(value: unknown): BootstrapCatalogIndex {
  if (!isRecord(value) || value.format !== "gik-bootstrap-catalog/1") {
    throw new Error("Unsupported bootstrap catalog format.");
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    throw new Error("Bootstrap catalog entries must be a non-empty array.");
  }
  const entries = value.entries.map((rawEntry, index): CatalogIndexEntry => {
    if (!isRecord(rawEntry)) throw new Error(`Bootstrap catalog entry ${index} is invalid.`);
    const id = requiredString(rawEntry.id, `entries.${index}.id`);
    return {
      id,
      artifact: relativeJsonPath(rawEntry.artifact, `entries.${id}.artifact`),
      ...(rawEntry.bootstrapAssets === undefined
        ? {}
        : {
            bootstrapAssets: relativeJsonPath(
              rawEntry.bootstrapAssets,
              `entries.${id}.bootstrapAssets`,
            ),
          }),
      ...(rawEntry.scenarios === undefined
        ? {}
        : { scenarios: relativeJsonPath(rawEntry.scenarios, `entries.${id}.scenarios`) }),
      ...(rawEntry.tests === undefined
        ? {}
        : { tests: relativeJsonPath(rawEntry.tests, `entries.${id}.tests`) }),
      ...(rawEntry.launch === undefined ? {} : { launch: parseLaunch(rawEntry.launch, id) }),
    };
  });
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
    throw new Error("Bootstrap catalog entry IDs must be unique.");
  }
  const launchIds = entries.flatMap(({ launch }) => launch ? [launch.id] : []);
  if (new Set(launchIds).size !== launchIds.length) {
    throw new Error("Bootstrap catalog launch IDs must be unique.");
  }
  const defaultLaunch = requiredString(value.defaultLaunch, "defaultLaunch");
  if (!launchIds.includes(defaultLaunch)) {
    throw new Error(`Bootstrap catalog default launch '${defaultLaunch}' is unavailable.`);
  }
  return {
    format: "gik-bootstrap-catalog/1",
    id: requiredString(value.id, "id"),
    defaultLaunch,
    entries,
  };
}

function blueprintStudioAssets(entries: Record<string, BlueprintArtifact>): BlueprintBootstrapAssets {
  const descriptors = Object.entries(entries)
    .map(([id, artifact]) => ({
      id,
      label: id,
      version: artifact.payload.version,
      kind: artifact.payload.kind,
      source: "repo",
      readonly: true,
      published: true,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    format: "gik-blueprint-bootstrap-assets/1",
    records: [
      { key: "index:blueprints", value: descriptors },
      ...descriptors.map((descriptor) => ({
        key: `blueprint:${descriptor.id}`,
        value: {
          ...descriptor,
          artifact: entries[descriptor.id] as unknown as Json,
          ref: `blueprint:${descriptor.id}@${descriptor.version}`,
          draft: null,
        },
      })),
    ],
  };
}

export async function loadBlueprintCatalogBundle(
  indexValue: unknown,
  readJson: ReadBootstrapJson,
): Promise<BlueprintCatalogBundle> {
  const index = parseBootstrapCatalogIndex(indexValue);
  const loaded = await Promise.all(index.entries.map(async (entry) => {
    const artifact = parseBlueprintJson(JSON.stringify(await readJson(entry.artifact)));
    if (artifact.payload.id !== entry.id) {
      throw new Error(
        `Bootstrap catalog entry '${entry.id}' loaded Blueprint '${artifact.payload.id}'.`,
      );
    }
    return {
      entry,
      artifact,
      bootstrapAssets: entry.bootstrapAssets
        ? parseBlueprintBootstrapAssets(await readJson(entry.bootstrapAssets))
        : undefined,
      scenarios: entry.scenarios
        ? parseScenarioDocument(await readJson(entry.scenarios))
        : undefined,
      tests: entry.tests
        ? parseBlueprintTestDocument(await readJson(entry.tests))
        : undefined,
    };
  }));
  const entries = Object.fromEntries(loaded.map(({ entry, artifact }) => [entry.id, artifact]));
  for (const { entry, tests, scenarios } of loaded) {
    if (tests && tests.blueprint !== entry.id) {
      throw new Error(`Bootstrap catalog entry '${entry.id}' loaded tests for '${tests.blueprint}'.`);
    }
    if (scenarios && scenarios.blueprint !== entry.id) {
      throw new Error(`Bootstrap catalog entry '${entry.id}' loaded scenarios for '${scenarios.blueprint}'.`);
    }
    if (scenarios) {
      validateScenarioDocumentTarget(scenarios, entries[entry.id]);
    }
  }
  const launches = loaded.flatMap(({ entry }) =>
    entry.launch ? [{ ...entry.launch, blueprint: entry.id }] : []);
  const defaultBlueprint = launches.find(({ id }) => id === index.defaultLaunch)?.blueprint;
  if (!defaultBlueprint) throw new Error(`Bootstrap catalog default launch '${index.defaultLaunch}' is invalid.`);
  const bootstrapAssets = Object.fromEntries(
    loaded.flatMap(({ entry, bootstrapAssets: assets }) => assets ? [[entry.id, assets]] : []),
  );
  if (entries["blueprint-studio-crud"]) {
    bootstrapAssets["blueprint-studio-crud"] = blueprintStudioAssets(entries);
  }
  const catalog = {
    format: "gik-blueprint-catalog/1" as const,
    bundleId: index.id,
    defaultBlueprint,
    blueprints: loaded.map(({ entry }) => entry.id),
    launchProfiles: launches,
    entries,
    scenarios: Object.fromEntries(
      loaded.flatMap(({ entry, scenarios }) => scenarios ? [[entry.id, scenarios]] : []),
    ),
    tests: Object.fromEntries(
      loaded.flatMap(({ entry, tests }) => tests ? [[entry.id, tests]] : []),
    ) as Record<string, BlueprintTestDocument>,
    bootstrapAssets,
  };
  const digest = await digestCatalog(catalog);
  return {
    ...catalog,
    bundleVersion: digest.slice(0, 16),
    digest: `sha256:${digest}`,
  };
}
