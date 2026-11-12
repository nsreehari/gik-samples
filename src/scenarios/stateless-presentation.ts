import {
  createCellGraphNodeExecutor,
  type MaterializedBlueprint,
} from "gik-blueprint";
import {
  CompositeStateModel,
  InMemoryStateModel,
  Kernel,
  unwrap,
  type Json,
  type ResolvedNode,
} from "gik-kernel";

function flattenState(
  value: Json,
  prefix = "",
  result: Record<string, Json> = {},
): Record<string, Json> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (prefix) result[prefix] = value;
    for (const [key, child] of Object.entries(value)) {
      flattenState(child, prefix ? `${prefix}.${key}` : key, result);
    }
  } else if (prefix) {
    result[prefix] = value;
  }
  return result;
}

export async function resolveStatelessPresentation(
  materializedBlueprint: MaterializedBlueprint,
  state: Record<string, Json>,
): Promise<ResolvedNode> {
  const { vocabulary, program, externalContext } = materializedBlueprint.payload;
  const namespaces = unwrap(vocabulary).namespaces ?? [];
  const local = new InMemoryStateModel(namespaces);
  local.apply(Object.entries(state)
    .filter(([namespace]) => namespaces.includes(namespace))
    .map(([path, value]) => ({ op: "set" as const, path, value })));
  const external = new InMemoryStateModel(["externalContext"]);
  external.apply([{
    op: "set",
    path: "externalContext",
    value: structuredClone(externalContext),
  }]);
  const runtimeState = new CompositeStateModel(local, { externalContext: external });
  const kernel = new Kernel(vocabulary, program, {
    state: runtimeState,
    executeGraphExtension: createCellGraphNodeExecutor(runtimeState),
  });
  kernel.hydrateGraph(flattenState(runtimeState.snapshot()));
  return kernel.resolve();
}
