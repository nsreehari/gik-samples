import React from "react";
import {
  PRESENTATION_FRAGMENT_CAPABILITY,
  type MaterializedBlueprint,
  type PresentationSlotLayout,
} from "@gik-ai/blueprint";
import {
  type Json,
  type ResolvedNode,
} from "@gik-ai/kernel";
import {
  buildBundleRegistry,
  bundleFromJson,
  renderNode,
  type BundleNative,
  type ProjectionView,
} from "@gik-ai/react";

import { resolveProjectionViews } from "./runtime/provider-registry";
import { resolveStatelessPresentation } from "../../scenarios/stateless-presentation";

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
    void resolveStatelessPresentation(materializedBlueprint, state).then((next) => {
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
