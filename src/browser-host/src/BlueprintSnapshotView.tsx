import React from "react";
import {
  createCellGraphNodeExecutor,
  PRESENTATION_FRAGMENT_CAPABILITY,
  type MaterializedBlueprint,
  type PresentationSlotLayout,
} from "@gik/blueprint";
import {
  CompositeStateModel,
  InMemoryStateModel,
  Kernel,
  unwrap,
  type Json,
  type ResolvedNode,
} from "@gik/kernel";
import {
  buildBundleRegistry,
  bundleFromJson,
  renderNode,
  type BundleNative,
  type ProjectionView,
} from "@gik/react";

import { resolveProjectionViews } from "./runtime/provider-registry";

const gaps: Record<NonNullable<PresentationSlotLayout["gap"]>, number> = {
  none: 0,
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
};

const PresentationFragment: ProjectionView = ({ node, children }) => {
  const layout = node.props.layout && typeof node.props.layout === "object"
    && !Array.isArray(node.props.layout)
    ? node.props.layout as PresentationSlotLayout
    : undefined;
  if (!layout) return <>{children}</>;
  return (
    <div
      data-presentation-slot={node.id}
      style={{
        display: "flex",
        flexDirection: layout.direction ?? "row",
        gap: gaps[layout.gap ?? "m"],
        alignItems: layout.align ?? "stretch",
        justifyContent: layout.justify ?? "start",
        flexWrap: layout.wrap ? "wrap" : "nowrap",
      }}
    >
      {children}
    </div>
  );
};

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

async function resolveSnapshotTree(
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
  external.apply([{ op: "set", path: "externalContext", value: structuredClone(externalContext) }]);
  const runtimeState = new CompositeStateModel(local, { externalContext: external });
  const kernel = new Kernel(vocabulary, program, {
    state: runtimeState,
    executeGraphExtension: createCellGraphNodeExecutor(runtimeState),
  });
  kernel.hydrateGraph(flattenState(runtimeState.snapshot()));
  return kernel.resolve();
}

export interface BlueprintSnapshotViewProps {
  materializedBlueprint: MaterializedBlueprint;
  state: Record<string, Json>;
  native?: BundleNative;
  onEvent(event: {
    node: string;
    name: string;
    payload?: Record<string, Json>;
    actorId?: string;
  }): void | Promise<unknown>;
}

export function BlueprintSnapshotView({
  materializedBlueprint,
  state,
  native,
  onEvent,
}: BlueprintSnapshotViewProps): React.ReactElement {
  const [tree, setTree] = React.useState<ResolvedNode | null>(null);
  const [error, setError] = React.useState<string>();
  const stateSignature = JSON.stringify(state);
  React.useEffect(() => {
    let active = true;
    setTree(null);
    setError(undefined);
    void resolveSnapshotTree(materializedBlueprint, state).then((next) => {
      if (active) setTree(next);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
    };
  }, [materializedBlueprint, stateSignature]);

  const bundle = React.useMemo(
    () => bundleFromJson({
      vocabulary: materializedBlueprint.payload.vocabulary,
      program: materializedBlueprint.payload.program,
      state,
    }, native),
    [materializedBlueprint, native, stateSignature],
  );
  const registry = React.useMemo(
    () => buildBundleRegistry(
      bundle,
      resolveProjectionViews,
      { [PRESENTATION_FRAGMENT_CAPABILITY]: PresentationFragment },
    ),
    [bundle],
  );
  if (error) return <div role="alert">{error}</div>;
  if (!tree) return <div role="status">Rendering presentation…</div>;
  return (
    <>
      {renderNode(tree, registry, (node, name, payload, actorId) =>
        onEvent({
          node,
          name,
          ...(payload ? { payload: payload as Record<string, Json> } : {}),
          ...(actorId ? { actorId } : {}),
        }))}
    </>
  );
}
