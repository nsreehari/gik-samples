import {
  materializeBlueprint,
  parseBlueprintJson,
  parseBlueprintReference,
  type BlueprintArtifact,
  type BlueprintHostRegistry,
  type ExternalContext,
} from "@gik/blueprint";
import { resolveDeclarativeFormInitialValue } from "@gik/evaluators";
import { openBlueprint, type BlueprintRuntime } from "@gik/controlface/blueprint";
import { createIndexedDbRecordLibrary } from "@gik/durable-runtime/storage/indexed-db";
import type { Json } from "@gik/kernel";
import { loadBlueprintCatalogBundle } from "../load-catalog";
import {
  applyHostConfig,
  hostConfig,
  type HostConfig,
} from "../config/host-config";
import {
  parseBlueprintBootstrapAssets,
  type BlueprintBootstrapAssets,
} from "./blueprint-bootstrap-assets";
import { digestCatalog } from "./catalog-digest";
import {
  parseBlueprintTestDocument,
  type BlueprintTestDocument,
} from "../../testing/declarative-blueprint-tests";
import {
  parseScenarioDocument,
  type ScenarioDocument,
  validateScenarioDocumentTarget,
} from "../../scenarios/scenario-document";

export const sampleBlueprintCatalogUrl = "bootstrap/catalog.json";
const artifactKind = "blueprint-seed-artifact";
const scenariosKind = "blueprint-seed-scenarios";
const bootstrapAssetsKind = "blueprint-seed-bootstrap-assets";
const metadataKind = "blueprint-seed-metadata";
const userArtifactKind = "blueprint-user-artifact";
const userNamespace = "gik-user-blueprints";

export interface BlueprintLaunchProfile {
  id: string;
  blueprint: string;
  label: string;
  description?: string;
  order?: number;
  context?: Readonly<Record<string, Json>>;
  requiredCapabilities?: readonly string[];
}

export interface BlueprintCatalogBundle {
  format: "gik-blueprint-catalog/1";
  bundleId: string;
  bundleVersion: string;
  digest: string;
  defaultBlueprint: string;
  blueprints: string[];
  launchProfiles: BlueprintLaunchProfile[];
  entries: Record<string, BlueprintArtifact>;
  scenarios: Record<string, ScenarioDocument>;
  tests: Record<string, BlueprintTestDocument>;
  bootstrapAssets: Record<string, BlueprintBootstrapAssets>;
}

export interface BlueprintCatalogSnapshot {
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly digest: string;
  readonly defaultBlueprint: string;
  readonly blueprints: readonly string[];
  readonly launchProfiles: readonly BlueprintLaunchProfile[];
  readonly seedEntries: Readonly<Record<string, BlueprintArtifact>>;
  readonly entries: Readonly<Record<string, BlueprintArtifact>>;
  readonly scenarios: Readonly<Record<string, ScenarioDocument>>;
  readonly tests: Readonly<Record<string, BlueprintTestDocument>>;
  readonly bootstrapAssets: Readonly<Record<string, BlueprintBootstrapAssets>>;
}

export interface BlueprintCatalogStore {
  admitSeed(bundle: BlueprintCatalogBundle): Promise<BlueprintCatalogSnapshot>;
  loadSeed(bundleId: string): Promise<BlueprintCatalogSnapshot | undefined>;
  readUserArtifacts(): Promise<{ blueprints: Record<string, BlueprintArtifact>; errors: string[] }>;
  writeUserArtifacts(blueprints: Record<string, BlueprintArtifact>): Promise<void>;
  close(): Promise<void>;
}

let catalog: BlueprintCatalogSnapshot | undefined;

export function installSampleBlueprintCatalog(snapshot: BlueprintCatalogSnapshot): void {
  catalog = snapshot;
}

export function getSampleBlueprintCatalog(): BlueprintCatalogSnapshot {
  if (!catalog) throw new Error("Sample Blueprint catalog has not been bootstrapped.");
  return catalog;
}

export function resolveSampleLaunchExternalContext(id: string): ExternalContext | undefined {
  const spec = getSampleBlueprintCatalog().entries[id]?.payload.contextFormSpec;
  return spec ? resolveDeclarativeFormInitialValue(spec) : undefined;
}

export function resolveSampleBlueprintBootstrapAssets(
  id: string,
): BlueprintBootstrapAssets | undefined {
  return getSampleBlueprintCatalog().bootstrapAssets[id];
}

export function resolveSampleBlueprintSource(
  id: string,
  config: HostConfig = hostConfig,
): BlueprintArtifact {
  const blueprint = getSampleBlueprintCatalog().entries[id];
  if (!blueprint) throw new Error(`Unknown Blueprint '${id}'`);
  return applyHostConfig(blueprint, config);
}

export function createSampleCatalogBlueprintRegistry(): BlueprintHostRegistry {
  return {
    resolveArtifact(reference) {
      const blueprint = resolveSampleBlueprintSource(reference.id);
      if (reference.version !== undefined && blueprint.payload.version !== reference.version) {
        throw new Error(`Blueprint '${reference.id}' version '${reference.version}' is unavailable`);
      }
      return blueprint;
    },
    resolve(reference, context) {
      const blueprint = this.resolveArtifact(reference, context);
      return {
        reference: { ...reference, version: reference.version ?? blueprint.payload.version },
        blueprint,
      };
    },
  };
}

export function openSampleBlueprint(
  id: string,
  externalContext?: ExternalContext,
  config: HostConfig = hostConfig,
): BlueprintRuntime {
  const materialized = materializeBlueprint({
    blueprint: resolveSampleBlueprintSource(id, config),
    externalContext,
    resolveBlueprint(reference) {
      const parsed = parseBlueprintReference(reference);
      const child = resolveSampleBlueprintSource(parsed.id, config);
      if (parsed.version !== undefined && child.payload.version !== parsed.version) {
        throw new Error(`Blueprint '${parsed.id}' version '${parsed.version}' is unavailable`);
      }
      return child;
    },
  });
  return openBlueprint(materialized.payload.terminalBlueprint);
}

export function installUserBlueprints(blueprints: Record<string, BlueprintArtifact>): void {
  installSampleBlueprintCatalog(withUserBlueprints(getSampleBlueprintCatalog(), blueprints));
}

export function parseBlueprintCatalogBundle(value: unknown): BlueprintCatalogBundle {
  if (!isRecord(value) || value.format !== "gik-blueprint-catalog/1") {
    throw new Error("Unsupported Blueprint catalog bundle format.");
  }
  if (typeof value.bundleId !== "string" || typeof value.bundleVersion !== "string" || typeof value.digest !== "string") {
    throw new Error("Blueprint catalog bundle identity is invalid.");
  }
  if (typeof value.defaultBlueprint !== "string" || !Array.isArray(value.blueprints) || !isRecord(value.entries)) {
    throw new Error("Blueprint catalog bundle metadata is invalid.");
  }
  const ids = value.blueprints.map(String);
  if (new Set(ids).size !== ids.length || !ids.includes(value.defaultBlueprint)) {
    throw new Error("Blueprint catalog IDs must be unique and include the default Blueprint.");
  }
  const entries: Record<string, BlueprintArtifact> = {};
  for (const [id, rawArtifact] of Object.entries(value.entries)) {
    const artifact = parseBlueprintJson(JSON.stringify(rawArtifact));
    if (artifact.payload.id !== id) throw new Error(`Blueprint catalog key '${id}' does not match '${artifact.payload.id}'.`);
    entries[id] = artifact;
  }
  for (const id of ids) {
    if (!entries[id]) throw new Error(`Listed Blueprint catalog entry '${id}' is missing.`);
  }
  const launchProfiles = blueprintLaunchProfiles(value.launchProfiles, entries);
  if (!launchProfiles.some((profile) => profile.blueprint === value.defaultBlueprint)) {
    throw new Error("The default Blueprint must have a launch profile.");
  }
  const scenarios = scenarioRecord(value.scenarios, entries);
  const tests = testDocumentRecord(value.tests, entries);
  const bootstrapAssets = bootstrapAssetsRecord(value.bootstrapAssets, entries);
  return {
    format: "gik-blueprint-catalog/1",
    bundleId: value.bundleId,
    bundleVersion: value.bundleVersion,
    digest: value.digest,
    defaultBlueprint: value.defaultBlueprint,
    blueprints: ids,
    launchProfiles,
    entries,
    scenarios,
    tests,
    bootstrapAssets,
  };
}

export function createBlueprintCatalogSnapshot(bundle: BlueprintCatalogBundle): BlueprintCatalogSnapshot {
  return {
    bundleId: bundle.bundleId,
    bundleVersion: bundle.bundleVersion,
    digest: bundle.digest,
    defaultBlueprint: bundle.defaultBlueprint,
    blueprints: Object.freeze([...bundle.blueprints]),
    launchProfiles: Object.freeze(bundle.launchProfiles.map((profile) => Object.freeze({
      ...profile,
      ...(profile.context === undefined
        ? {}
        : { context: Object.freeze(structuredClone(profile.context)) }),
      ...(profile.requiredCapabilities === undefined
        ? {}
        : { requiredCapabilities: Object.freeze([...profile.requiredCapabilities]) }),
    }))),
    seedEntries: Object.freeze({ ...bundle.entries }),
    entries: Object.freeze({ ...bundle.entries }),
    scenarios: Object.freeze({ ...bundle.scenarios }),
    tests: Object.freeze({ ...bundle.tests }),
    bootstrapAssets: Object.freeze({ ...bundle.bootstrapAssets }),
  };
}

export function withUserBlueprints(
  snapshot: BlueprintCatalogSnapshot,
  userBlueprints: Record<string, BlueprintArtifact>,
): BlueprintCatalogSnapshot {
  return {
    ...snapshot,
    entries: Object.freeze({ ...userBlueprints, ...snapshot.seedEntries }),
  };
}

export async function verifyBlueprintCatalogBundle(bundle: BlueprintCatalogBundle): Promise<void> {
  const catalog = {
    format: bundle.format,
    bundleId: bundle.bundleId,
    defaultBlueprint: bundle.defaultBlueprint,
    blueprints: bundle.blueprints,
    launchProfiles: bundle.launchProfiles,
    entries: bundle.entries,
    scenarios: bundle.scenarios,
    tests: bundle.tests,
    bootstrapAssets: bundle.bootstrapAssets,
  };
  const digest = await digestCatalog(catalog);
  if (bundle.digest !== `sha256:${digest}` || bundle.bundleVersion !== digest.slice(0, 16)) {
    throw new Error("Blueprint catalog bundle digest is invalid.");
  }
}

export function createIndexedDbBlueprintCatalogStore(options: {
  databaseName?: string;
  indexedDB?: IDBFactory;
} = {}): BlueprintCatalogStore {
  const library = createIndexedDbRecordLibrary({
    databaseName: options.databaseName ?? "gik-samples-host",
    indexedDB: options.indexedDB,
  });
  return {
    async admitSeed(bundle) {
      await library.transaction("readwrite", async (store) => {
        const existing = await library.records(store, artifactKind, bundle.bundleId);
        const admittedIds = new Set<string>();
        for (const id of Object.keys(bundle.entries)) {
          const key = `${id}@${bundle.entries[id].payload.version}`;
          const recordId = library.id(artifactKind, bundle.bundleId, key);
          admittedIds.add(recordId);
          await library.request(store.put({
            id: recordId,
            namespace: bundle.bundleId,
            kind: artifactKind,
            key,
            blueprintId: id,
            artifact: bundle.entries[id],
          }));
        }
        for (const record of existing) {
          if (!admittedIds.has(record.id)) await library.request(store.delete(record.id));
        }
        const existingScenarios = await library.records(store, scenariosKind, bundle.bundleId);
        const admittedScenarioIds = new Set<string>();
        for (const [id, document] of Object.entries(bundle.scenarios)) {
          const recordId = library.id(scenariosKind, bundle.bundleId, id);
          admittedScenarioIds.add(recordId);
          await library.request(store.put({
            id: recordId,
            namespace: bundle.bundleId,
            kind: scenariosKind,
            key: id,
            blueprintId: id,
            document,
          }));
        }
        for (const record of existingScenarios) {
          if (!admittedScenarioIds.has(record.id)) await library.request(store.delete(record.id));
        }
        const existingBootstrapAssets = await library.records(store, bootstrapAssetsKind, bundle.bundleId);
        const admittedBootstrapAssetIds = new Set<string>();
        for (const [id, assets] of Object.entries(bundle.bootstrapAssets)) {
          const recordId = library.id(bootstrapAssetsKind, bundle.bundleId, id);
          admittedBootstrapAssetIds.add(recordId);
          await library.request(store.put({
            id: recordId,
            namespace: bundle.bundleId,
            kind: bootstrapAssetsKind,
            key: id,
            blueprintId: id,
            assets,
          }));
        }
        for (const record of existingBootstrapAssets) {
          if (!admittedBootstrapAssetIds.has(record.id)) await library.request(store.delete(record.id));
        }
        await library.request(store.put({
          id: library.id(metadataKind, bundle.bundleId, "active"),
          namespace: bundle.bundleId,
          kind: metadataKind,
          key: "active",
          bundleVersion: bundle.bundleVersion,
          digest: bundle.digest,
          defaultBlueprint: bundle.defaultBlueprint,
          blueprints: bundle.blueprints,
          launchProfiles: bundle.launchProfiles,
          tests: bundle.tests,
        }));
      });
      const snapshot = await this.loadSeed(bundle.bundleId);
      if (!snapshot) throw new Error(`Admitted Blueprint catalog '${bundle.bundleId}' could not be loaded.`);
      return snapshot;
    },
    async loadSeed(bundleId) {
      return library.transaction("readonly", async (store) => {
        const metadata = await library.request(store.get(library.id(metadataKind, bundleId, "active"))) as Record<string, unknown> | undefined;
        if (!metadata) return undefined;
        const records = await library.records(store, artifactKind, bundleId);
        const entries: Record<string, BlueprintArtifact> = {};
        for (const record of records) {
          const id = String(record.blueprintId);
          entries[id] = parseBlueprintJson(JSON.stringify(record.artifact));
        }
        const scenarioRecords = await library.records(store, scenariosKind, bundleId);
        const scenarios = Object.fromEntries(scenarioRecords.map((record) => [
          String(record.blueprintId),
          parseScenarioDocument(record.document),
        ])) as Record<string, ScenarioDocument>;
        const bootstrapAssetRecords = await library.records(store, bootstrapAssetsKind, bundleId);
        const bootstrapAssets = Object.fromEntries(bootstrapAssetRecords.map((record) => [
          String(record.blueprintId),
          record.assets,
        ])) as Record<string, BlueprintBootstrapAssets>;
        return createBlueprintCatalogSnapshot({
          format: "gik-blueprint-catalog/1",
          bundleId,
          bundleVersion: String(metadata.bundleVersion),
          digest: String(metadata.digest),
          defaultBlueprint: String(metadata.defaultBlueprint),
          blueprints: Array.isArray(metadata.blueprints) ? metadata.blueprints.map(String) : [],
          launchProfiles: blueprintLaunchProfiles(metadata.launchProfiles, entries),
          entries,
          scenarios,
          tests: testDocumentRecord(metadata.tests, entries),
          bootstrapAssets,
        });
      });
    },
    async readUserArtifacts() {
      return library.transaction("readonly", async (store) => {
        const records = await library.records(store, userArtifactKind, userNamespace);
        const blueprints: Record<string, BlueprintArtifact> = {};
        const errors: string[] = [];
        for (const record of records) {
          try {
            const artifact = parseBlueprintJson(JSON.stringify(record.artifact));
            blueprints[artifact.payload.id] = artifact;
          } catch (error) {
            errors.push(`${record.key}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return { blueprints, errors };
      });
    },
    async writeUserArtifacts(blueprints) {
      const validated = Object.fromEntries(Object.entries(blueprints).map(([id, artifact]) => {
        const parsed = parseBlueprintJson(JSON.stringify(artifact));
        if (parsed.payload.id !== id) throw new Error(`User Blueprint key '${id}' does not match '${parsed.payload.id}'.`);
        return [id, parsed];
      }));
      await library.transaction("readwrite", async (store) => {
        const existing = await library.records(store, userArtifactKind, userNamespace);
        const admittedIds = new Set<string>();
        for (const [id, artifact] of Object.entries(validated)) {
          const recordId = library.id(userArtifactKind, userNamespace, id);
          admittedIds.add(recordId);
          await library.request(store.put({
            id: recordId,
            namespace: userNamespace,
            kind: userArtifactKind,
            key: id,
            artifact,
          }));
        }
        for (const record of existing) {
          if (!admittedIds.has(record.id)) await library.request(store.delete(record.id));
        }
      });
    },
    close: () => library.close(),
  };
}

export async function bootstrapSampleBlueprintCatalog(options: {
  seedUrl?: string;
  databaseName?: string;
  fetch?: typeof globalThis.fetch;
  indexedDB?: IDBFactory;
} = {}): Promise<BlueprintCatalogSnapshot> {
  const fetchSeed = options.fetch ?? globalThis.fetch;
  const response = await fetchSeed(
    options.seedUrl ?? new URL(sampleBlueprintCatalogUrl, document.baseURI).href,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Unable to load Blueprint catalog seed (${response.status}).`);
  const indexUrl = response.url || options.seedUrl || new URL(sampleBlueprintCatalogUrl, document.baseURI).href;
  const bundle = parseBlueprintCatalogBundle(await loadBlueprintCatalogBundle(
    await response.json(),
    async (path) => {
      const assetResponse = await fetchSeed(new URL(path, indexUrl).href, { cache: "no-store" });
      if (!assetResponse.ok) {
        throw new Error(`Unable to load Blueprint catalog asset '${path}' (${assetResponse.status}).`);
      }
      return assetResponse.json();
    },
  ));
  await verifyBlueprintCatalogBundle(bundle);
  const store = createIndexedDbBlueprintCatalogStore(options);
  try {
    const seed = await store.admitSeed(bundle);
    const users = await store.readUserArtifacts();
    return withUserBlueprints(seed, users.blueprints);
  } finally {
    await store.close();
  }
}

export async function readUserBlueprintArtifacts(options: {
  databaseName?: string;
  indexedDB?: IDBFactory;
} = {}): Promise<{ blueprints: Record<string, BlueprintArtifact>; errors: string[] }> {
  const store = createIndexedDbBlueprintCatalogStore(options);
  try {
    return await store.readUserArtifacts();
  } finally {
    await store.close();
  }
}

export async function writeUserBlueprintArtifacts(
  blueprints: Record<string, BlueprintArtifact>,
  options: { databaseName?: string; indexedDB?: IDBFactory } = {},
): Promise<void> {
  const store = createIndexedDbBlueprintCatalogStore(options);
  try {
    await store.writeUserArtifacts(blueprints);
  } finally {
    await store.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scenarioRecord(
  value: unknown,
  entries: Record<string, BlueprintArtifact>,
): Record<string, ScenarioDocument> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("Blueprint catalog scenarios must be an object.");
  return Object.fromEntries(Object.entries(value).map(([id, document]) => {
    if (!entries[id]) throw new Error(`Scenarios reference unknown Blueprint '${id}'.`);
    const parsed = parseScenarioDocument(document);
    if (parsed.blueprint !== id) {
      throw new Error(`Scenarios for Blueprint '${id}' target '${parsed.blueprint}'.`);
    }
    validateScenarioDocumentTarget(parsed, entries[id]);
    return [id, parsed];
  }));
}

function testDocumentRecord(
  value: unknown,
  entries: Record<string, BlueprintArtifact>,
): Record<string, BlueprintTestDocument> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("Blueprint catalog tests must be an object.");
  return Object.fromEntries(Object.entries(value).map(([id, document]) => {
    if (!entries[id]) throw new Error(`Tests reference unknown Blueprint '${id}'.`);
    const parsed = parseBlueprintTestDocument(document);
    if (parsed.blueprint !== id) {
      throw new Error(`Tests for Blueprint '${id}' target '${parsed.blueprint}'.`);
    }
    return [id, parsed];
  }));
}

function bootstrapAssetsRecord(
  value: unknown,
  entries: Record<string, BlueprintArtifact>,
): Record<string, BlueprintBootstrapAssets> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("Blueprint catalog bootstrap assets must be an object.");
  return Object.fromEntries(Object.entries(value).map(([id, rawAssets]) => {
    if (!entries[id]) throw new Error(`Bootstrap assets reference unknown Blueprint '${id}'.`);
    try {
      return [id, parseBlueprintBootstrapAssets(rawAssets)];
    } catch (error) {
      throw new Error(`Bootstrap assets for Blueprint '${id}' are invalid.`, { cause: error });
    }
  }));
}

function blueprintLaunchProfiles(
  value: unknown,
  entries: Record<string, BlueprintArtifact>,
): BlueprintLaunchProfile[] {
  if (!Array.isArray(value)) throw new Error("Blueprint catalog launch profiles must be an array.");
  const profiles = value.map((item) => {
    if (!isRecord(item)
      || typeof item.id !== "string"
      || typeof item.blueprint !== "string"
      || typeof item.label !== "string"
      || (item.description !== undefined && typeof item.description !== "string")
      || (item.order !== undefined && (typeof item.order !== "number" || !Number.isFinite(item.order)))
      || (item.context !== undefined && !isRecord(item.context))
      || (item.requiredCapabilities !== undefined
        && (!Array.isArray(item.requiredCapabilities)
          || item.requiredCapabilities.some((capability) => typeof capability !== "string" || capability.length === 0)))) {
      throw new Error("Blueprint catalog contains an invalid launch profile.");
    }
    if (!entries[item.blueprint]) {
      throw new Error(`Blueprint launch profile '${item.id}' references unknown Blueprint '${item.blueprint}'.`);
    }
    const profile: BlueprintLaunchProfile = {
      id: item.id,
      blueprint: item.blueprint,
      label: item.label,
      ...(item.description === undefined ? {} : { description: item.description }),
      ...(item.order === undefined ? {} : { order: item.order }),
      ...(item.context === undefined
        ? {}
        : { context: structuredClone(item.context) as Record<string, Json> }),
      ...(item.requiredCapabilities === undefined
        ? {}
        : { requiredCapabilities: [...new Set(item.requiredCapabilities as string[])] }),
    };
    return profile;
  });
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
    throw new Error("Blueprint launch profile IDs must be unique.");
  }
  return profiles;
}