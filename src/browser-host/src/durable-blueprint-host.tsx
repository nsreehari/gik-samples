import React from "react";
import { Spinner } from "@fluentui/react-components";
import {
  materializeBlueprint,
  parseBlueprintReference,
  prepareBlueprintProgram,
  type MaterializedBlueprint,
} from "@gik-ai/blueprint";
import {
  buildCapabilityCatalogFromExternals,
  type BlueprintHostProps,
  type BundleNative,
} from "@gik-ai/react";
import {
  BlueprintHost,
  BlueprintProvider,
  createNativeBlueprintWorker,
} from "@gik-ai/react/durable";
import { createIndexedDbProvider } from "@gik-ai/durable-runtime/storage/indexed-db";
import { createIndexedDbStorageRef } from "@gik-ai/durable-runtime/storage/indexed-db/api";

interface DurableBlueprintProps extends BlueprintHostProps {
  resolveNative?: (blueprint: MaterializedBlueprint) => BundleNative;
}

function useDurableBlueprint(props: DurableBlueprintProps) {
  const blueprintId = props.blueprint.payload.id;
  const [indexedDbProvider] = React.useState(() =>
    createIndexedDbProvider({ databaseName: "gik-samples-host" }));
  const materializedBlueprint = React.useMemo(() => {
    const parentInstanceId = props.primaryInstanceId === undefined
      ? blueprintId
      : `${blueprintId}:${props.primaryInstanceId}`;
    const materialized = materializeBlueprint({
      blueprint: props.blueprint,
      externalContext: props.externalContext,
      resolveBlueprint: (ref, childContext) => {
        if (!props.blueprintRegistry) throw new Error(`No Blueprint host registry can resolve '${ref}'`);
        return props.blueprintRegistry.resolveArtifact(parseBlueprintReference(ref), {
          ...childContext,
          parentInstanceId,
        });
      },
      ...(props.resolveCapabilityDescriptors
        ? {
            capabilityCatalog: buildCapabilityCatalogFromExternals(
              props.blueprint.payload.runtime?.externals,
              props.resolveCapabilityDescriptors,
            ),
          }
        : {}),
    });
    if (!props.context) return materialized;
    const initialState = prepareBlueprintProgram(materialized.payload.terminalBlueprint, {
      context: props.context,
    }).initialState;
    return {
      ...materialized,
      payload: { ...materialized.payload, initialState: structuredClone(initialState) },
    };
  }, [
    blueprintId,
    props.blueprint,
    props.blueprintRegistry,
    props.context,
    props.externalContext,
    props.primaryInstanceId,
    props.resolveCapabilityDescriptors,
  ]);
  const native = React.useMemo(
    () => props.resolveNative?.(materializedBlueprint) ?? props.native,
    [materializedBlueprint, props.native, props.resolveNative],
  );
  const runtime = React.useMemo(() => {
    const identity = JSON.stringify({
      blueprintId,
      instanceId: props.primaryInstanceId ?? "default",
      externalContext: props.externalContext ?? {},
      context: props.context ?? {},
    });
    const ref = createIndexedDbStorageRef(`samples:${identity}`);
    return {
      runtimeId: ref,
      providers: { "indexed-db": indexedDbProvider },
      refs: { stateRef: ref, journalRef: ref, effectsQueueRef: ref },
    };
  }, [blueprintId, indexedDbProvider, props.context, props.externalContext, props.primaryInstanceId]);
  const worker = React.useMemo(
    () => native
      ? createNativeBlueprintWorker({
          blueprint: props.blueprint,
          runtime,
          native,
          externalContext: props.externalContext,
          materializedBlueprint,
          contexts: props.contexts,
          effectRetry: { maxAttempts: 1 },
        })
      : undefined,
    [materializedBlueprint, native, props.blueprint, props.contexts, props.externalContext, runtime],
  );
  return { materializedBlueprint, native, runtime, worker };
}

function loadingBlueprint(): React.ReactElement {
  return <Spinner label={"Loading analysis\u00a0\u2026"} labelPosition="after" size="small" />;
}

export function DurableBlueprintHost(props: DurableBlueprintProps): React.ReactElement {
  const durable = useDurableBlueprint(props);
  return (
    <BlueprintHost
      {...props}
      {...durable}
      renderHostedBlueprintLoading={loadingBlueprint}
    />
  );
}

export function DurableBlueprintProvider({
  children,
  ...props
}: DurableBlueprintProps & {
  children: React.ReactNode;
}): React.ReactElement {
  const durable = useDurableBlueprint(props);
  return (
    <BlueprintProvider {...props} {...durable}>
      {children}
    </BlueprintProvider>
  );
}
