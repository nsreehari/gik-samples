import type { MaterializedBlueprint } from "@gik-ai/blueprint";
import {
  projectCellRunState,
  type BlueprintRunState,
  type CellRunState,
  type Json,
  type ProjectedSourceRunState,
} from "@gik-ai/kernel";

export interface ScenarioDataFlowNode {
  [key: string]: unknown;
  id: string;
  title: string;
  tone: "accent" | "danger" | "success" | "neutral";
  sources: ScenarioDataFlowSource[];
  width: number;
  draggable: boolean;
}

export interface ScenarioDataFlowSource {
  service: string;
  operation: string;
  status: "idle" | "running" | "queued" | "completed" | "failed";
}

export interface ScenarioDataFlowPort {
  [key: string]: unknown;
  id: string;
  token: string;
  hasValue: boolean;
  value?: Json;
  running?: boolean;
}

export interface ScenarioDataFlowPorts {
  left?: ScenarioDataFlowPort[];
  right?: ScenarioDataFlowPort[];
}

export interface ScenarioDataFlowModel {
  nodes: ScenarioDataFlowNode[];
  nodePorts: Record<string, ScenarioDataFlowPorts>;
}

function runStateFrom(state: Record<string, Json>): BlueprintRunState {
  const candidate = state.blueprintRunState;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    && candidate.cells && typeof candidate.cells === "object" && !Array.isArray(candidate.cells)
    ? candidate as unknown as BlueprintRunState
    : { cells: {} };
}

function cellTitle(id: string, metadata: Record<string, Json> | undefined): string {
  const title = metadata?.title ?? metadata?.label;
  return typeof title === "string" && title.trim() ? title : id;
}

function readPath(value: unknown, path: string): Json | undefined {
  let current: unknown = value;
  for (const segment of path.split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current as Json | undefined;
}

function outputValue(
  from: string | undefined,
  state: Record<string, Json>,
  cellState: CellRunState | undefined,
): Json | undefined {
  if (!from) return undefined;
  if (from.startsWith("sources.")) {
    return cellState?.sourceValues?.[from.slice("sources.".length)];
  }
  if (from.startsWith("computed.")) {
    return readPath(state, from.slice("computed.".length));
  }
  return readPath(state, from);
}

function sourceStatus(source: ProjectedSourceRunState | undefined): ScenarioDataFlowSource["status"] {
  if (!source) return "idle";
  if (source.lastRequestFailed) return "failed";
  if (source.status === "running") return "running";
  if (source.hasPendingRequest) return "queued";
  if (source.lastCompletionStatus === "success") return "completed";
  return "idle";
}

export function createScenarioDataFlowModel(
  materializedBlueprint: MaterializedBlueprint,
  state: Record<string, Json>,
  activeEventNode?: string,
): ScenarioDataFlowModel {
  const blueprint = materializedBlueprint.payload.terminalBlueprint;
  const cells = blueprint.payload.cells ?? {};
  const runtime = runStateFrom(state);
  const activeCell = activeEventNode
    ? materializedBlueprint.payload.eventNodeOwners[activeEventNode] ?? activeEventNode
    : undefined;
  const nodes: ScenarioDataFlowNode[] = [];
  const nodePorts: Record<string, ScenarioDataFlowPorts> = {};
  const tokenValues = new Map<string, Json>();

  for (const [id, cell] of Object.entries(cells)) {
    const cellState = runtime.cells[id];
    for (const output of cell.outputs ?? []) {
      const value = outputValue(output.from ?? output.token, state, cellState);
      if (value !== undefined) tokenValues.set(output.token, value);
    }
  }

  for (const [id, cell] of Object.entries(cells)) {
    const projected = runtime.cells[id] ? projectCellRunState(runtime.cells[id]) : undefined;
    const projectedSources = new Map(projected?.sources.map((source) => [source.id, source]) ?? []);
    const running = (projected?.numSourcesRunning ?? 0) > 0;
    const failed = projected?.sources.some(({ lastRequestFailed }) => lastRequestFailed) ?? false;
    const inputCount = cell.inputs?.length ?? 0;
    const outputCount = cell.outputs?.length ?? 0;
    nodes.push({
      id,
      title: cellTitle(id, cell.metadata),
      tone: failed ? "danger" : running || activeCell === id ? "accent" : "neutral",
      sources: (cell.sources ?? []).map((source) => ({
        service: source.service,
        operation: source.operation,
        status: sourceStatus(projectedSources.get(source.id)),
      })),
      width: 260,
      draggable: true,
    });
    nodePorts[id] = {
      ...(inputCount > 0
        ? {
            left: cell.inputs!.map((input, index) => ({
              id: `${id}:input:${index}`,
              token: input.token,
              hasValue: tokenValues.has(input.token),
              ...(tokenValues.has(input.token) ? { value: tokenValues.get(input.token) } : {}),
              ...(running ? { running: true } : {}),
            })),
          }
        : {}),
      ...(outputCount > 0
        ? {
            right: cell.outputs!.map((output, index) => ({
              id: `${id}:output:${index}`,
              token: output.token,
              hasValue: tokenValues.has(output.token),
              ...(tokenValues.has(output.token) ? { value: tokenValues.get(output.token) } : {}),
              ...(running ? { running: true } : {}),
            })),
          }
        : {}),
    };
  }
  return { nodes, nodePorts };
}
