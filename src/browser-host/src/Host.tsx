// The generic host app opens a Blueprint selected by an explicit `?b=<id>` through
// the standard Blueprint host. Without that parameter there is no single "current" Blueprint at all: the
// host renders its own application root page, which composes named regions of an embedded Blueprint
// Studio instead of silently opening a default Blueprint. The app owns URL canonicalization and the
// switcher overlay.

import React from "react";
import { Spinner } from "@fluentui/react-components";
import {
  materializeBlueprint,
  parseBlueprintReference,
  type ExternalContext,
  type MaterializedBlueprint,
} from "@gik-ai/blueprint";
import {
  BlueprintHost as InMemoryBlueprintHost,
  buildCapabilityCatalogFromExternals,
  type BlueprintHostProps,
  type BundleNative,
  type OrganismBridge,
} from "@gik-ai/react";
import { resolveCapabilityDescriptors, resolveProjectionViews } from "./runtime/provider-registry";
import {
  canonicalizeHostUrl,
  readHostQuery,
} from "./host-query";
import { resolveSampleLaunchExternalContext } from "../../bootstrap/catalog/blueprint-catalog";
import { HostServiceDependencyAccess } from "./runtime/service-dependency-access";
import { ApplicationSwitcher } from "./ApplicationSwitcher";
import { AppRootPage } from "./AppRootPage";
import { useBlueprintHostSetup } from "./blueprint-host-setup";
import { DurableBlueprintHost } from "./durable-blueprint-host";
import { BlueprintTestsPage } from "./BlueprintTestsPage";
import {
  ScenarioExplorerPage,
} from "./ScenarioExplorerPage";

export { createSampleBlueprintProposalStore } from "./blueprint-host-setup";

const embeddedHostStyle: React.CSSProperties = { height: "100vh" };

export function Host(): React.ReactElement {
  const query = readHostQuery(window.location.search, window.location.pathname);
  React.useEffect(() => {
    const canonicalUrl = canonicalizeHostUrl(window.location.href);
    if (canonicalUrl !== window.location.href) window.history.replaceState(null, "", canonicalUrl);
  }, []);
  if (query.testsEnabled) return <BlueprintTestsPage />;
  if (query.scenariosEnabled) {
    return <ScenarioExplorerPage />;
  }
  // No selected Blueprint is not "the default Blueprint": it is the application root itself.
  if (query.targetId === null) {
    return <AppRootPage durableEnabled={query.durableEnabled} />;
  }
  return (
    <HostView
      targetId={query.targetId}
      durableEnabled={query.durableEnabled}
      externalContext={query.externalContext}
      HostComponent={query.durableEnabled ? DurableBlueprintHost : InMemoryHost}
    />
  );
}

function hostedBlueprintLoading(): React.ReactElement {
  return <Spinner label={"Loading analysis\u00a0\u2026"} labelPosition="after" size="small" />;
}

function InMemoryHost(props: BlueprintHostProps): React.ReactElement {
  return <InMemoryBlueprintHost {...props} renderHostedBlueprintLoading={hostedBlueprintLoading} />;
}

function ResolvedTargetHost({
  HostComponent,
  resolveNative,
  ...props
}: BlueprintHostProps & {
  HostComponent: React.ComponentType<BlueprintHostProps>;
  resolveNative?: (materializedBlueprint: MaterializedBlueprint) => BundleNative;
}): React.ReactElement {
  const parentInstanceId = props.primaryInstanceId === undefined
    ? props.blueprint.payload.id
    : `${props.blueprint.payload.id}:${props.primaryInstanceId}`;
  const materialized = React.useMemo(
    () => materializeBlueprint({
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
    }),
    [
      parentInstanceId,
      props.blueprint,
      props.blueprintRegistry,
      props.externalContext,
      props.resolveCapabilityDescriptors,
    ],
  );
  const resolvedNative = React.useMemo(
    () => resolveNative?.(materialized) ?? props.native,
    [materialized, props.native, resolveNative],
  );
  return <HostComponent {...props} native={resolvedNative} />;
}

function HostView({
  targetId,
  durableEnabled,
  externalContext,
  HostComponent,
  primaryBridge,
  primaryInstanceId,
  showApplicationSwitcher = true,
  style = embeddedHostStyle,
}: {
  targetId: string;
  durableEnabled: boolean;
  externalContext?: ExternalContext;
  HostComponent: React.ComponentType<BlueprintHostProps>;
  primaryBridge?: OrganismBridge;
  primaryInstanceId?: string;
  showApplicationSwitcher?: boolean;
  style?: React.CSSProperties;
}): React.ReactElement {
  const launchExternalContext = externalContext ?? resolveSampleLaunchExternalContext(targetId);
  const { blueprint, native, context, blueprintRegistry, resolveNative } = useBlueprintHostSetup({
    id: targetId,
    durableEnabled,
    externalContext: launchExternalContext,
  });
  return (
    <>
      <ResolvedTargetHost
        HostComponent={HostComponent}
        blueprint={blueprint}
        externalContext={launchExternalContext}
        native={native}
        context={context}
        resolveNative={resolveNative}
        resolveLeavesProvider={resolveProjectionViews}
        resolveCapabilityDescriptors={resolveCapabilityDescriptors}
        blueprintRegistry={blueprintRegistry}
        primaryBridge={primaryBridge}
        primaryInstanceId={primaryInstanceId}
        style={style}
      />
      <HostServiceDependencyAccess />
      {showApplicationSwitcher ? <ApplicationSwitcher currentId={targetId} /> : null}
    </>
  );
}
