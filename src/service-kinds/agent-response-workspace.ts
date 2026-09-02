import {
  materializeBlueprint,
  validateBlueprintForAuthoring,
  type BlueprintArtifact,
} from "@gik-ai/blueprint";
import type {
  AgentTool,
  AgentToolExecutionContext,
} from "@gik-ai/agent-lifecycle-exp";
import type { CapabilityDescriptor, Json } from "@gik-ai/kernel";
import { resolveSampleCapabilityDescriptors } from "../shared/capability-descriptors";
import { agentResponseToolContracts } from "./agent-response-tool-contracts";

interface ResponseSlot {
  field: string;
  pointer: string;
}

interface CapabilityDerivation {
  viewsField: string;
  acceptedCapabilities: string[];
  tierPointer: string;
  importsPointer: string;
}

export interface AgentResponseWorkspaceSpec {
  scaffold: Json;
  slots: ResponseSlot[];
  capabilityDerivation?: CapabilityDerivation;
}

interface AgentResponseWorkspace {
  spec: AgentResponseWorkspaceSpec;
  proposal?: BlueprintArtifact;
}

const workspaces = new Map<string, AgentResponseWorkspace>();
const forbiddenPointerSegments = new Set(["__proto__", "prototype", "constructor"]);

function record(value: unknown, name: string): Record<string, Json> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, Json>;
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith("/")) throw new Error(`Response slot pointer '${pointer}' must be an absolute JSON Pointer`);
  return pointer.slice(1).split("/").map((segment) =>
    segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function setPointer(target: Json, pointer: string, value: Json): void {
  const segments = pointerSegments(pointer);
  if (segments.length === 0) throw new Error("Response slot pointer cannot target the document root");
  let cursor: unknown = target;
  for (const segment of segments.slice(0, -1)) {
    if (forbiddenPointerSegments.has(segment)) throw new Error(`Unsafe response slot pointer segment '${segment}'`);
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        throw new Error(`Response slot pointer '${pointer}' does not exist in the scaffold`);
      }
      cursor = cursor[index];
    } else {
      const container = record(cursor, `Response slot pointer '${pointer}'`);
      if (!(segment in container)) throw new Error(`Response slot pointer '${pointer}' does not exist in the scaffold`);
      cursor = container[segment];
    }
  }
  const leaf = segments.at(-1)!;
  if (forbiddenPointerSegments.has(leaf)) throw new Error(`Unsafe response slot pointer segment '${leaf}'`);
  if (Array.isArray(cursor)) {
    const index = Number(leaf);
    if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
      throw new Error(`Response slot pointer '${pointer}' does not exist in the scaffold`);
    }
    cursor[index] = structuredClone(value);
  } else {
    const container = record(cursor, `Response slot pointer '${pointer}'`);
    if (!(leaf in container)) throw new Error(`Response slot pointer '${pointer}' does not exist in the scaffold`);
    container[leaf] = structuredClone(value);
  }
}

function collectViewCapabilities(value: Json): string[] {
  const capabilities = new Set<string>();
  const visit = (candidate: Json): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const capability = candidate.capability;
    if (typeof capability === "string") capabilities.add(capability);
    for (const decoration of ["before", "after", "wrap"] as const) {
      const entries = candidate[decoration];
      if (Array.isArray(entries)) entries.forEach(visit);
    }
  };
  Object.values(record(value, "Agent-authored views")).forEach(visit);
  return [...capabilities];
}

function projectionImports(capabilities: readonly string[]): Record<string, Json> {
  const imports: Record<string, { from: string; use: string[] }> = {};
  for (const capability of capabilities) {
    const separator = capability.indexOf(":");
    if (separator <= 0 || separator === capability.length - 1) {
      throw new Error(`Capability '${capability}' must use the '<provider>:<name>' form`);
    }
    const provider = capability.slice(0, separator);
    const name = capability.slice(separator + 1);
    const entry = imports[provider] ??= { from: provider, use: [] };
    if (!entry.use.includes(name)) entry.use.push(name);
  }
  return imports;
}

function capabilityCatalog(
  imports: Record<string, { from: string; use?: readonly string[] }> | undefined,
): Record<string, CapabilityDescriptor> {
  const catalog: Record<string, CapabilityDescriptor> = {};
  for (const [alias, spec] of Object.entries(imports ?? {})) {
    const descriptors = resolveSampleCapabilityDescriptors(spec.from);
    if (!descriptors) continue;
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (spec.use && !spec.use.includes(name)) continue;
      catalog[`${alias}:${name}`] = descriptor;
    }
  }
  return catalog;
}

function hostCapabilityCatalog(artifact: BlueprintArtifact): Record<string, CapabilityDescriptor> {
  return capabilityCatalog(
    artifact.payload.runtime.externals?.projectionViews as
      | Record<string, { from: string; use?: readonly string[] }>
      | undefined,
  );
}

function candidateSummary(candidate: BlueprintArtifact): Record<string, Json> {
  const cells = candidate.payload.cells ?? {};
  const views = Object.values(cells).flatMap((cell) => Object.values(cell.potentialViews ?? {}));
  return {
    ok: true,
    blueprintId: candidate.payload.id,
    cellIds: Object.keys(cells),
    viewCount: views.length,
    capabilities: [...new Set(views.flatMap((view) => [
      view.capability,
      ...(view.before ?? []).map(({ capability }) => capability),
      ...(view.after ?? []).map(({ capability }) => capability),
      ...(view.wrap ?? []).map(({ capability }) => capability),
    ]).filter((capability): capability is string => typeof capability === "string"))],
    regions: views.flatMap(({ region }) =>
      region === undefined ? [] : Array.isArray(region) ? [...region] : [region]),
  };
}

export function composeAgentResponse(
  spec: AgentResponseWorkspaceSpec,
  fragmentValue: Json,
): BlueprintArtifact {
  const fragment = record(fragmentValue, "Agent response fragment");
  const fields = spec.slots.map(({ field }) => field);
  if (new Set(fields).size !== fields.length) throw new Error("Agent response slots must have unique field names");
  const missing = fields.filter((field) => !(field in fragment));
  const extra = Object.keys(fragment).filter((field) => !fields.includes(field));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error([
      missing.length > 0 ? `missing fields: ${missing.join(", ")}` : "",
      extra.length > 0 ? `unexpected fields: ${extra.join(", ")}` : "",
    ].filter(Boolean).join("; "));
  }

  const candidate = structuredClone(spec.scaffold);
  for (const slot of spec.slots) setPointer(candidate, slot.pointer, fragment[slot.field]);

  if (spec.capabilityDerivation) {
    const derivation = spec.capabilityDerivation;
    const views = fragment[derivation.viewsField];
    if (views === undefined) throw new Error(`Capability derivation field '${derivation.viewsField}' is missing`);
    const capabilities = collectViewCapabilities(views);
    const accepted = new Set(derivation.acceptedCapabilities);
    const rejected = capabilities.filter((capability) => !accepted.has(capability));
    if (rejected.length > 0) {
      throw new Error(`Agent response uses capabilities outside the accepted set: ${rejected.join(", ")}`);
    }
    setPointer(candidate, derivation.tierPointer, capabilities);
    setPointer(candidate, derivation.importsPointer, projectionImports(capabilities));
  }

  const report = validateBlueprintForAuthoring(candidate);
  if (!report.valid || !report.artifact) {
    throw new Error(`Composed agent response is not a valid Blueprint: ${report.errors.join("; ")}`);
  }
  try {
    materializeBlueprint({
      blueprint: report.artifact,
      capabilityCatalog: hostCapabilityCatalog(report.artifact),
    });
  } catch (error) {
    throw new Error(
      `Composed agent response cannot be materialized by this host: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return report.artifact;
}

function workspace(context: AgentToolExecutionContext | undefined): AgentResponseWorkspace {
  const requestId = context?.requestId;
  if (!requestId) throw new Error("Agent response tools require a request scope");
  const value = workspaces.get(requestId);
  if (!value) throw new Error(`No agent response workspace is open for request '${requestId}'`);
  return value;
}

function fragmentFromToolArgs(args: unknown, name: string): Json {
  const input = record(args, name);
  if (typeof input.fragmentJson !== "string") throw new Error(`${name}.fragmentJson must be a JSON string`);
  try {
    return JSON.parse(input.fragmentJson) as Json;
  } catch (error) {
    throw new Error(`${name}.fragmentJson is not valid JSON`, { cause: error });
  }
}

export function createAgentResponseTools(): readonly AgentTool[] {
  return [
    {
      name: "compose_response_validate",
      ...agentResponseToolContracts.compose_response_validate,
      lifecycle: "agent",
      handler: (args, context) => {
        const candidate = composeAgentResponse(
          workspace(context).spec,
          fragmentFromToolArgs(args, "validate input"),
        );
        return candidateSummary(candidate);
      },
    },
    {
      name: "compose_response_simulate",
      ...agentResponseToolContracts.compose_response_simulate,
      lifecycle: "agent",
      handler: (args, context) => {
        const candidate = composeAgentResponse(
          workspace(context).spec,
          fragmentFromToolArgs(args, "simulate input"),
        );
        const materialized = materializeBlueprint({
          blueprint: candidate,
          capabilityCatalog: hostCapabilityCatalog(candidate),
        });
        return {
          ...candidateSummary(candidate),
          presentation: materialized.payload.terminalBlueprint.payload.presentation ?? null,
          stateNamespaces: Object.keys(materialized.payload.initialState),
        };
      },
    },
    {
      name: "compose_response_read_in_progress_proposal",
      ...agentResponseToolContracts.compose_response_read_in_progress_proposal,
      lifecycle: "agent",
      handler: (_args, context) => workspace(context).proposal ?? null,
    },
    {
      name: "compose_response_set_in_progress_proposal",
      ...agentResponseToolContracts.compose_response_set_in_progress_proposal,
      lifecycle: "agent",
      handler: (args, context) => {
        const current = workspace(context);
        current.proposal = composeAgentResponse(
          current.spec,
          fragmentFromToolArgs(args, "proposal input"),
        );
        return { ...candidateSummary(current.proposal), stored: true };
      },
    },
  ];
}

export function openAgentResponseWorkspace(requestId: string, spec: AgentResponseWorkspaceSpec): void {
  if (workspaces.has(requestId)) throw new Error(`Agent response workspace '${requestId}' is already open`);
  workspaces.set(requestId, { spec: structuredClone(spec) });
}

export function readAgentResponseProposal(requestId: string): BlueprintArtifact | undefined {
  return workspaces.get(requestId)?.proposal;
}

export function closeAgentResponseWorkspace(requestId: string): void {
  workspaces.delete(requestId);
}

export function parseAgentResponseWorkspaceSpec(value: Json | undefined): AgentResponseWorkspaceSpec | undefined {
  if (value === undefined) return undefined;
  const candidate = record(value, "authoringWorkspace");
  if (!candidate.scaffold || typeof candidate.scaffold !== "object" || Array.isArray(candidate.scaffold)) {
    throw new Error("authoringWorkspace.scaffold must be an object");
  }
  if (!Array.isArray(candidate.slots)) throw new Error("authoringWorkspace.slots must be an array");
  const slots = candidate.slots.map((entry) => {
    const slot = record(entry, "authoringWorkspace slot");
    if (typeof slot.field !== "string" || typeof slot.pointer !== "string") {
      throw new Error("Each authoringWorkspace slot requires string field and pointer values");
    }
    return { field: slot.field, pointer: slot.pointer };
  });
  if (slots.length === 0) throw new Error("authoringWorkspace.slots must not be empty");
  const derivationValue = candidate.capabilityDerivation;
  let capabilityDerivation: CapabilityDerivation | undefined;
  if (derivationValue !== undefined) {
    const derivation = record(derivationValue, "authoringWorkspace.capabilityDerivation");
    if (
      typeof derivation.viewsField !== "string"
      || !Array.isArray(derivation.acceptedCapabilities)
      || !derivation.acceptedCapabilities.every((entry) => typeof entry === "string")
      || typeof derivation.tierPointer !== "string"
      || typeof derivation.importsPointer !== "string"
    ) {
      throw new Error("authoringWorkspace.capabilityDerivation is invalid");
    }
    capabilityDerivation = {
      viewsField: derivation.viewsField,
      acceptedCapabilities: derivation.acceptedCapabilities,
      tierPointer: derivation.tierPointer,
      importsPointer: derivation.importsPointer,
    };
  }
  return {
    scaffold: candidate.scaffold,
    slots,
    ...(capabilityDerivation ? { capabilityDerivation } : {}),
  };
}
