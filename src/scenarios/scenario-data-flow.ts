import type { MaterializedBlueprint } from "@gik/blueprint";
import {
  projectCellRunState,
  type BlueprintRunState,
  type Json,
} from "@gik/kernel";

export interface ScenarioDataFlowNode {
  id: string;
  title: string;
  eyebrow: string;
  detail: string;
  tone: "accent" | "danger" | "success" | "neutral";
  width: number;
  draggable: false;
}

export interface ScenarioDataFlowPort {
  id: string;
  token: string;
  label: string;
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

  for (const [id, cell] of Object.entries(cells)) {
    const projected = runtime.cells[id] ? projectCellRunState(runtime.cells[id]) : undefined;
    const running = (projected?.numSourcesRunning ?? 0) > 0;
    const failed = projected?.sources.some(({ lastRequestFailed }) => lastRequestFailed) ?? false;
    const inputCount = cell.inputs?.length ?? 0;
    const outputCount = cell.outputs?.length ?? 0;
    nodes.push({
      id,
      title: cellTitle(id, cell.metadata),
      eyebrow: running ? "Running" : failed ? "Source failed" : activeCell === id ? "Current act" : "Cell",
      detail: `${inputCount} input${inputCount === 1 ? "" : "s"} · ${outputCount} output${outputCount === 1 ? "" : "s"}${cell.sources?.length ? ` · ${cell.sources.length} source${cell.sources.length === 1 ? "" : "s"}` : ""}`,
      tone: failed ? "danger" : running || activeCell === id ? "accent" : "neutral",
      width: 260,
      draggable: false,
    });
    nodePorts[id] = {
      ...(inputCount > 0
        ? {
            left: cell.inputs!.map((input, index) => ({
              id: `${id}:input:${index}`,
              token: input.token,
              label: input.as ? `${input.as} (${input.token})` : input.token,
              ...(running ? { running: true } : {}),
            })),
          }
        : {}),
      ...(outputCount > 0
        ? {
            right: cell.outputs!.map((output, index) => ({
              id: `${id}:output:${index}`,
              token: output.token,
              label: output.token,
              ...(running ? { running: true } : {}),
            })),
          }
        : {}),
    };
  }
  return { nodes, nodePorts };
}
