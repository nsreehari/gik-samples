import React from "react";
import {
  Body1,
  Button,
  Caption1,
  Dropdown,
  Label,
  Option,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Spinner,
  Subtitle1,
  Tab,
  TabList,
  ToggleButton,
  makeStyles,
  mergeClasses,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from "@fluentui/react-components";
import {
  ArrowResetRegular,
  ClipboardEditRegular,
  ClockRegular,
  DataTrendingRegular,
  PauseRegular,
  PlayRegular,
  PresenterRegular,
  SparkleRegular,
  TimerRegular,
  WindowRegular,
} from "@fluentui/react-icons";
import {
  GikComponent,
  PaneWithTriggerBody,
  PaneWithTriggerFooter,
  PaneWithTriggerHeader,
} from "gik-components";
import {
  materializeBlueprint,
  parseBlueprintReference,
  type ExternalContext,
  type MaterializedBlueprint,
} from "gik-blueprint";
import type { GIKEvent, Json } from "gik-kernel";
import { buildCapabilityCatalogFromExternals, type BundleNative } from "gik-react";

import {
  getSampleBlueprintCatalog,
  resolveSampleLaunchExternalContext,
} from "../../bootstrap/catalog/blueprint-catalog";
import { createScenarioDataFlowModel } from "../../scenarios/scenario-data-flow";
import {
  collectScenarioObservation,
  evaluateScenarioWait,
  flattenScenarioActs,
  type FlatScenarioAct,
  type ScenarioDefinition,
  type ScenarioDocument,
} from "../../scenarios/scenario-document";
import { runScenarioTransition } from "../../scenarios/scenario-runner";
import { jsonValuesEqual } from "../../shared/json-path";
import { useBlueprintHostSetup } from "./blueprint-host-setup";
import {
  writeBlueprintQuery,
} from "./host-query";
import {
  resolveCapabilityDescriptors,
} from "./runtime/provider-registry";

const BlueprintSnapshotView = React.lazy(async () => {
  const module = await import("./BlueprintSnapshotView");
  return { default: module.BlueprintSnapshotView };
});
const ScenarioDataFlowCanvas = React.lazy(async () => {
  const module = await import("./ScenarioDataFlowCanvas");
  return { default: module.ScenarioDataFlowCanvas };
});

interface ScenarioEntry {
  document: ScenarioDocument;
  scenario: ScenarioDefinition;
  authored: boolean;
}

interface ScenarioBlueprintChoice {
  id: string;
  label: string;
}

type ActStatus = "pending" | "running" | "waiting" | "completed" | "failed";
type ExecutionStatus = "idle" | "running" | "waiting" | "completed" | "failed";
type RunnerMode = "steps" | "acts";
type TimerPace = "automatic" | "presenter";

const TIMER_PACE_MS: Record<TimerPace, number> = {
  automatic: 2_000,
  presenter: 120_000,
};

const useStyles = makeStyles({
  page: {
    position: "relative",
    height: "100vh",
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  field: {
    display: "grid",
    gap: tokens.spacingVerticalXS,
  },
  runner: {
    display: "grid",
    alignContent: "start",
    gap: tokens.spacingVerticalL,
  },
  runnerIntro: {
    display: "grid",
    gap: tokens.spacingVerticalM,
  },
  progressSummary: {
    display: "grid",
    gap: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
  },
  passiveHeader: {
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
  },
  progressDetail: {
    display: "grid",
    gap: tokens.spacingVerticalXXS,
  },
  timerControls: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
  },
  timerAction: {
    display: "flex",
    alignItems: "center",
    gap: 0,
  },
  paceToggle: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
  },
  timerUtilities: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  journalContent: {
    display: "grid",
    gap: tokens.spacingVerticalS,
    paddingRight: tokens.spacingHorizontalXS,
    paddingBottom: tokens.spacingVerticalM,
  },
  journalList: {
    display: "grid",
    gap: tokens.spacingVerticalS,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  journalCard: {
    position: "relative",
    display: "grid",
    gap: tokens.spacingVerticalXS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXXL} ${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  journalCardCurrent: {
    backgroundColor: tokens.colorBrandBackground2,
    boxShadow: `inset 0 0 0 ${tokens.strokeWidthThin} ${tokens.colorBrandStroke1}`,
  },
  journalCardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
  },
  journalCardCopy: {
    display: "grid",
    gap: tokens.spacingVerticalXXS,
    minWidth: 0,
  },
  journalCardDescription: { color: tokens.colorNeutralForeground3 },
  journalCardIndex: {
    position: "absolute",
    right: tokens.spacingHorizontalM,
    bottom: tokens.spacingVerticalS,
    color: tokens.colorNeutralForegroundDisabled,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    fontVariantNumeric: "tabular-nums",
    userSelect: "none",
  },
  actDetail: {
    maxWidth: "260px",
    margin: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  actRail: {
    display: "grid",
    gap: tokens.spacingVerticalXS,
    margin: `${tokens.spacingVerticalXS} 0 0`,
    padding: `0 0 0 ${tokens.spacingHorizontalM}`,
    borderLeft: `${tokens.strokeWidthThick} solid ${tokens.colorNeutralStroke2}`,
    listStyle: "none",
  },
  actRailItem: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
    fontSize: tokens.fontSizeBase200,
  },
  actRailIcon: {
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
  },
  surface: {
    position: "absolute",
    inset: 0,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  surfaceLoading: {
    display: "grid",
    placeItems: "center",
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
  },
  presentationSurface: {
    height: "100%",
    overflow: "auto",
    boxSizing: "border-box",
    padding: tokens.spacingHorizontalXL,
  },
  surfaceToggle: {
    position: "fixed",
    left: "24px",
    bottom: "24px",
    zIndex: 1030,
    boxShadow: tokens.shadow16,
  },
  drawerBody: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    minHeight: 0,
    height: "100%",
  },
  drawerTabs: { marginBottom: tokens.spacingVerticalM },
  drawerPanel: { minHeight: 0, overflow: "hidden" },
  context: {
    display: "grid",
    alignContent: "start",
    gap: tokens.spacingVerticalM,
    height: "100%",
    overflow: "auto",
    paddingRight: tokens.spacingHorizontalXS,
  },
  pickerContainer: {
    padding: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  scenarioEmptyState: {
    padding: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  error: { color: tokens.colorPaletteRedForeground1 },
  presentation: { minHeight: "100%", minWidth: 0 },
});

function defaultContextId(entry: ScenarioEntry): string {
  const applicable = entry.scenario.applicableContexts
    ?? Object.keys(entry.document.contextPresets);
  return entry.scenario.contextPreset ?? applicable[0] ?? "";
}

function blueprintLabel(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function actKind(act: FlatScenarioAct): "event" | "wait" | "observe" {
  if ("event" in act) return "event";
  if ("wait" in act) return "wait";
  return "observe";
}

function actIcon(act: FlatScenarioAct): React.ReactElement {
  if ("event" in act) return <SparkleRegular />;
  if ("wait" in act) return <ClockRegular />;
  return <ClipboardEditRegular />;
}

function actDetail(
  act: FlatScenarioAct,
  observation?: Record<string, Json>,
): Record<string, Json> {
  if ("event" in act) return act.event as unknown as Record<string, Json>;
  if ("wait" in act) return act.wait as unknown as Record<string, Json>;
  return observation ?? act.observe as unknown as Record<string, Json>;
}

function ActDetailPopover({
  act,
  observation,
}: {
  act: FlatScenarioAct;
  observation?: Record<string, Json>;
}): React.ReactElement {
  const styles = useStyles();
  const kind = actKind(act);
  return (
    <Popover positioning="below-end">
      <PopoverTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          size="small"
          shape="circular"
          icon={actIcon(act)}
          aria-label={`Inspect ${kind} act details`}
          title={`${kind[0]?.toUpperCase()}${kind.slice(1)} act`}
        />
      </PopoverTrigger>
      <PopoverSurface>
        <pre className={styles.actDetail}>
          {JSON.stringify(actDetail(act, observation), null, 2)}
        </pre>
      </PopoverSurface>
    </Popover>
  );
}

export function ScenarioExplorerPage(): React.ReactElement {
  const styles = useStyles();
  const catalog = React.useMemo(() => getSampleBlueprintCatalog(), []);
  const entries = React.useMemo(
    () => catalog.blueprints.flatMap((blueprintId) => {
      const authoredDocument = catalog.scenarios[blueprintId];
      if (authoredDocument?.scenarios.length) {
        return authoredDocument.scenarios.map((scenario) => ({
          document: authoredDocument,
          scenario,
          authored: true,
        }));
      }
      const defaultContextId = "default";
      const document: ScenarioDocument = {
        format: "gik-scenarios/1",
        blueprint: blueprintId,
        contextPresets: {
          [defaultContextId]: {
            label: "Default",
            context: resolveSampleLaunchExternalContext(blueprintId) ?? {},
          },
        },
        scenarios: [{
          id: "blueprint-overview",
          title: blueprintLabel(blueprintId),
          description: "This Blueprint does not define an authored Scenario.",
          contextPreset: defaultContextId,
          steps: [],
        }],
      };
      return [{ document, scenario: document.scenarios[0], authored: false }];
    }),
    [catalog.blueprints, catalog.scenarios],
  );
  const blueprintChoices = React.useMemo<ScenarioBlueprintChoice[]>(
    () => catalog.blueprints.map((id) => ({
      id,
      label: blueprintLabel(id),
    })),
    [catalog.blueprints],
  );
  if (entries.length === 0) throw new Error("The Scenario Explorer requires at least one scenario.");
  const initialBlueprintId = React.useMemo(
    () => typeof window === "undefined"
      ? undefined
      : new URLSearchParams(window.location.search).get("b")?.trim() || undefined,
    [],
  );
  const requestedSelection = entries.findIndex(({ document }) =>
    document.blueprint === initialBlueprintId);
  const defaultBlueprintSelection = entries.findIndex(({ document }) =>
    document.blueprint === catalog.defaultBlueprint);
  const authoredScenarioSelection = entries.findIndex(({ document }) =>
    Boolean(catalog.scenarios[document.blueprint]?.scenarios.length));
  const initialSelection = Math.max(
    0,
    requestedSelection >= 0
      ? requestedSelection
      : defaultBlueprintSelection >= 0
        ? defaultBlueprintSelection
        : authoredScenarioSelection,
  );
  const [selection, setSelection] = React.useState(initialSelection);
  const entry = entries[selection] ?? entries[0];
  React.useEffect(() => {
    if (typeof window === "undefined" || !initialBlueprintId) return;
    const url = writeBlueprintQuery(window.location.href, initialBlueprintId);
    if (url !== window.location.href) window.history.replaceState(null, "", url);
  }, [initialBlueprintId]);

  return (
    <main className={styles.page}>
      <ScenarioWorkspace
        key={`${entry.document.blueprint}:${entry.scenario.id}`}
        entry={entry}
        entries={entries}
        blueprintChoices={blueprintChoices}
        selection={selection}
        onSelection={setSelection}
      />
    </main>
  );
}

function ScenarioWorkspace({
  entry,
  entries,
  blueprintChoices,
  selection,
  onSelection,
}: {
  entry: ScenarioEntry;
  entries: ScenarioEntry[];
  blueprintChoices: ScenarioBlueprintChoice[];
  selection: number;
  onSelection(value: number): void;
}): React.ReactElement {
  const styles = useStyles();
  const initialContextId = defaultContextId(entry);
  const initialContext = structuredClone(
    entry.document.contextPresets[initialContextId]?.context ?? {},
  );
  const [appliedContext, setAppliedContext] = React.useState<ExternalContext>(initialContext);
  const [contextDraft, setContextDraft] = React.useState<ExternalContext>(initialContext);
  const [appliedContextId, setAppliedContextId] = React.useState<string | undefined>(initialContextId || undefined);
  const [draftContextId, setDraftContextId] = React.useState<string | undefined>(initialContextId || undefined);
  const [runnerMode, setRunnerMode] = React.useState<RunnerMode>("steps");
  const [timerPace, setTimerPace] = React.useState<TimerPace>("automatic");
  const [rightTab, setRightTab] = React.useState(() => entry.authored ? "journal" : "context");
  const setup = useBlueprintHostSetup({
    id: entry.document.blueprint,
    durableEnabled: false,
    externalContext: appliedContext,
  });
  const materializedBlueprint = React.useMemo(
    () => materializeBlueprint({
      blueprint: setup.blueprint,
      externalContext: appliedContext,
      resolveBlueprint: (reference, childContext) =>
        setup.blueprintRegistry.resolveArtifact(parseBlueprintReference(reference), {
          ...childContext,
          parentInstanceId: `scenario:${entry.scenario.id}`,
        }),
      capabilityCatalog: buildCapabilityCatalogFromExternals(
        setup.blueprint.payload.runtime?.externals,
        resolveCapabilityDescriptors,
      ),
    }),
    [
      appliedContext,
      entry.scenario.id,
      setup.blueprint,
      setup.blueprintRegistry,
    ],
  );
  const hasPresentation = Boolean(
    materializedBlueprint.payload.terminalBlueprint.payload.presentation,
  );
  const [leftTab, setLeftTab] = React.useState(
    () => hasPresentation ? "presentation" : "data-flow",
  );
  const native = React.useMemo(
    () => setup.resolveNative(materializedBlueprint),
    [materializedBlueprint, setup.resolveNative],
  );
  const [blueprintState, setBlueprintState] = React.useState<Record<string, Json>>(
    () => structuredClone(materializedBlueprint.payload.initialState),
  );
  const stateRef = React.useRef(blueprintState);
  const materializedRef = React.useRef(materializedBlueprint);
  const nativeRef = React.useRef(native);
  stateRef.current = blueprintState;
  materializedRef.current = materializedBlueprint;
  nativeRef.current = native;
  const commitState = React.useCallback((next: Record<string, Json>) => {
    stateRef.current = next;
    setBlueprintState(next);
  }, []);

  const acts = React.useMemo(
    () => flattenScenarioActs(entry.scenario),
    [entry.scenario],
  );
  const [cursor, setCursor] = React.useState(0);
  const [actStatuses, setActStatuses] = React.useState<ActStatus[]>(
    () => acts.map(() => "pending"),
  );
  const [actObservations, setActObservations] = React.useState<Record<number, Record<string, Json>>>({});
  const [executionStatus, setExecutionStatus] = React.useState<ExecutionStatus>("idle");
  const [running, setRunning] = React.useState(false);
  const [timerEpoch, setTimerEpoch] = React.useState(0);
  const [timerPaused, setTimerPaused] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const startedRef = React.useRef(false);
  const runningRef = React.useRef(false);
  const runTokenRef = React.useRef(0);
  const currentAct = acts[cursor];

  const runTransition = React.useCallback(async (event: GIKEvent): Promise<Record<string, Json>> => {
    return runScenarioTransition({
      state: stateRef.current,
      materializedBlueprint: materializedRef.current,
      native: nativeRef.current,
      event,
    });
  }, []);

  const transition = React.useCallback(async (event: GIKEvent): Promise<void> => {
    commitState(await runTransition(event));
  }, [commitState, runTransition]);

  const runCurrentAct = React.useCallback(async (): Promise<void> => {
    if (runningRef.current || cursor >= acts.length) return;
    const act = acts[cursor];
    if (!act) return;
    const runToken = ++runTokenRef.current;
    runningRef.current = true;
    setRunning(true);
    setExecutionStatus("running");
    if (!startedRef.current && entry.scenario.resetAtStart) {
      const initialState = structuredClone(materializedBlueprint.payload.initialState);
      commitState(await runScenarioTransition({
        state: initialState,
        materializedBlueprint: materializedRef.current,
        native: nativeRef.current,
      }));
    }
    startedRef.current = true;
    setError(undefined);
    try {
      setActStatuses((current) => current.map((status, index) =>
        index === cursor ? "running" : status));
      if ("wait" in act) {
        const conditionMet = await evaluateScenarioWait(act, {
          state: stateRef.current,
          context: appliedContext,
        });
        if (runTokenRef.current !== runToken) return;
        if (!conditionMet) {
          setActStatuses((current) => current.map((status, index) =>
            index === cursor ? "waiting" : status));
          setExecutionStatus("waiting");
          return;
        }
      } else if ("observe" in act) {
        const observations = await collectScenarioObservation(act, {
          state: stateRef.current,
          context: appliedContext,
        });
        if (runTokenRef.current !== runToken) return;
        setActObservations((current) => ({ ...current, [cursor]: observations }));
      } else {
        const nextState = await runTransition(act.event);
        if (runTokenRef.current !== runToken) return;
        commitState(nextState);
      }
      if (runTokenRef.current !== runToken) return;
      setActStatuses((current) => current.map((status, index) =>
        index === cursor ? "completed" : status));
      const nextCursor = cursor + 1;
      setCursor(nextCursor);
      setExecutionStatus(nextCursor >= acts.length ? "completed" : "idle");
    } catch (reason: unknown) {
      if (runTokenRef.current !== runToken) return;
      setActStatuses((current) => current.map((status, index) =>
        index === cursor ? "failed" : status));
      setError(reason instanceof Error ? reason.message : String(reason));
      setExecutionStatus("failed");
    } finally {
      if (runTokenRef.current === runToken) {
        runningRef.current = false;
        setRunning(false);
      }
    }
  }, [
    acts,
    appliedContext,
    commitState,
    cursor,
    entry.scenario.resetAtStart,
    materializedBlueprint.payload.initialState,
    runTransition,
  ]);

  const stop = () => {
    runTokenRef.current += 1;
    runningRef.current = false;
    setRunning(false);
    setTimerPaused(true);
    setExecutionStatus("idle");
    setActStatuses((current) => current.map((status) =>
      status === "running" ? "pending" : status));
  };
  const reset = () => {
    runTokenRef.current += 1;
    runningRef.current = false;
    setRunning(false);
    setTimerPaused(false);
    setTimerEpoch((value) => value + 1);
    commitState(structuredClone(materializedBlueprint.payload.initialState));
    setCursor(0);
    setActStatuses(acts.map(() => "pending"));
    setActObservations({});
    setExecutionStatus("idle");
    setError(undefined);
    startedRef.current = false;
  };
  const applyContext = (values: ExternalContext) => {
    if (running) return;
    const presetId = Object.entries(entry.document.contextPresets)
      .find(([, preset]) => jsonValuesEqual(values, preset.context))?.[0];
    const next = structuredClone(values);
    setContextDraft(next);
    setAppliedContext(next);
    setDraftContextId(presetId);
    setAppliedContextId(presetId);
  };
  const choosePreset = (id: string) => {
    const preset = entry.document.contextPresets[id];
    if (!preset) return;
    setDraftContextId(id);
    setContextDraft(structuredClone(preset.context));
  };
  const dataFlow = React.useMemo(
    () => createScenarioDataFlowModel(
      materializedBlueprint,
      blueprintState,
      running && currentAct && "event" in currentAct ? currentAct.event.node : undefined,
    ),
    [blueprintState, currentAct, materializedBlueprint, running],
  );
  const applicableContextIds = entry.scenario.applicableContexts
    ?? Object.keys(entry.document.contextPresets);
  const contextFormSpec = setup.blueprint.payload.contextFormSpec;
  const currentStepIndex = currentAct?.stepIndex ?? entry.scenario.steps.length;
  const currentStep = entry.scenario.steps[currentStepIndex];
  const scenarioStarted = actStatuses.some((status) => status !== "pending");
  const timerDurationMs = TIMER_PACE_MS[timerPace];
  const timerLabel = currentAct && "wait" in currentAct
    ? "Check condition"
    : currentAct && "observe" in currentAct
      ? "Record observation"
      : "Run event";
  const stepProgressItems = entry.scenario.steps.map((step, stepIndex) => {
    const statuses = acts
      .filter((act) => act.stepIndex === stepIndex)
      .map((act) => actStatuses[act.globalIndex]);
    return {
      id: step.id,
      order: stepIndex,
      title: step.title,
      icon: "step",
      status: statuses.includes("failed")
        ? "failed"
        : stepIndex < currentStepIndex
          ? "completed"
          : scenarioStarted && stepIndex === currentStepIndex && executionStatus !== "completed"
            ? "current"
            : "upcoming",
    };
  });
  const actProgressItems = acts.map((act) => ({
    id: act.id,
    order: act.globalIndex,
    title: act.title,
    icon: actKind(act),
    status: actStatuses[act.globalIndex] === "failed"
      ? "failed"
      : act.globalIndex < cursor || actStatuses[act.globalIndex] === "completed"
        ? "completed"
        : scenarioStarted && act.globalIndex === cursor && executionStatus !== "completed"
          ? "current"
          : "upcoming",
  }));
  const progressItems = runnerMode === "steps" ? stepProgressItems : actProgressItems;
  const scenarioEntries = entries
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.document.blueprint === entry.document.blueprint);
  const scenarioOptions = scenarioEntries.map(({ candidate, index }) => ({
    value: String(index),
    label: candidate.scenario.title,
    ...(candidate.scenario.description ? { description: candidate.scenario.description } : {}),
    disabled: running,
  }));
  const visibleActs = cursor >= acts.length ? acts : acts.slice(0, cursor + 1);
  const visibleStepCount = executionStatus === "completed"
    ? entry.scenario.steps.length
    : Math.min(currentStepIndex + 1, entry.scenario.steps.length);
  const visibleSteps = entry.scenario.steps.slice(0, visibleStepCount);
  const selectControlTab = (_: SelectTabEvent, data: SelectTabData) =>
    setRightTab(String(data.value));
  const toggleTimerPace = () => {
    setTimerPace((current) => current === "automatic" ? "presenter" : "automatic");
    setTimerPaused(false);
  };
  const chooseBlueprint = (blueprintId: string) => {
    const nextIndex = entries.findIndex(({ document }) => document.blueprint === blueprintId);
    if (running) return;
    if (typeof window === "undefined") {
      if (nextIndex >= 0) onSelection(nextIndex);
      return;
    }
    window.location.assign(writeBlueprintQuery(window.location.href, blueprintId));
  };

  return (
    <>
      <section className={styles.surface} aria-label="Scenario Blueprint">
        <React.Suspense fallback={<div className={styles.surfaceLoading}><Spinner label="Loading surface..." size="small" /></div>}>
          {leftTab === "presentation" && hasPresentation ? (
            <div className={styles.presentationSurface}>
              <BlueprintSnapshotView
                materializedBlueprint={materializedBlueprint}
                state={blueprintState}
                native={native}
                onEvent={(event) => running ? undefined : transition(event)}
              />
            </div>
          ) : (
            <ScenarioDataFlowCanvas
              blueprintId={entry.document.blueprint}
              scenarioTitle={entry.scenario.title}
              model={dataFlow}
            />
          )}
        </React.Suspense>
      </section>
      {hasPresentation ? (
        <Button
          className={styles.surfaceToggle}
          appearance="primary"
          shape="circular"
          size="large"
          icon={leftTab === "data-flow" ? <WindowRegular /> : <DataTrendingRegular />}
          aria-label={leftTab === "data-flow" ? "Show presentation" : "Show data flow"}
          title={leftTab === "data-flow" ? "Show presentation" : "Show data flow"}
          onClick={() => setLeftTab((current) =>
            current === "data-flow" ? "presentation" : "data-flow")}
        />
      ) : null}
      <GikComponent
        kind="primitive:pane-with-trigger"
        id="scenario-controls"
        componentProps={{
          variant: "floating-drawer",
          title: "Scenario controls",
          ariaLabel: "Scenario controls",
          fabPosition: "top-right",
          openLabel: "Open scenario controls",
          closeLabel: "Close scenario controls",
          panelWidthPx: 320,
        }}
      >
        <PaneWithTriggerHeader>
          {entry.authored ? (
            <div className={styles.progressSummary} aria-live="polite">
              <GikComponent
                kind="semantic:process"
                id="scenario-step-progress"
                data={progressItems as unknown as Json}
                variant="progress"
                componentProps={{
                  spec: {
                    title: entry.scenario.title,
                    fields: {
                      id: "id",
                      title: "title",
                      order: "order",
                      status: "status",
                      icon: "icon",
                    },
                    toneMap: {
                      completed: "complete",
                      current: "current",
                      upcoming: "upcoming",
                      failed: "blocked",
                    },
                  },
                }}
              />
            </div>
          ) : (
            <span className={styles.passiveHeader}>{blueprintLabel(entry.document.blueprint)}</span>
          )}
        </PaneWithTriggerHeader>
        <PaneWithTriggerBody>
          <div className={styles.drawerBody}>
            <TabList className={styles.drawerTabs} selectedValue={rightTab} onTabSelect={selectControlTab}>
            {entry.authored
              ? <Tab value="journal">{runnerMode === "steps" ? "Steps" : "Acts"}</Tab>
              : null}
            <Tab value="context">Context</Tab>
            <Tab value="scenarios">Scenarios</Tab>
            </TabList>
            <div className={styles.drawerPanel}>
          {rightTab === "scenarios" ? (
            <div className={mergeClasses(styles.runnerIntro, styles.context)}>
              <div
                className={mergeClasses(styles.field, styles.pickerContainer)}
                aria-label="Blueprint selection"
              >
                <Label htmlFor="scenario-blueprint-select">Blueprint</Label>
                <Dropdown
                  id="scenario-blueprint-select"
                  value={blueprintChoices.find(({ id }) => id === entry.document.blueprint)?.label
                    ?? blueprintLabel(entry.document.blueprint)}
                  selectedOptions={[entry.document.blueprint]}
                  disabled={running}
                  onOptionSelect={(_, data) => chooseBlueprint(String(data.optionValue))}
                >
                  {blueprintChoices.map((choice) => (
                    <Option key={choice.id} value={choice.id}>
                      {choice.label}
                    </Option>
                  ))}
                </Dropdown>
              </div>
              {entry.authored ? (
                <GikComponent
                  kind="fluent:list"
                  id="scenario-list"
                  data={scenarioOptions as unknown as Json}
                  variant="vertical-cards"
                  componentProps={{
                    ariaLabel: "Scenarios",
                    selectionMode: "single",
                    selectedValues: [String(selection)],
                  }}
                  onEvent={(event) => {
                    if (event.name !== "select" || running) return;
                    const values = event.payload.values;
                    const nextIndex = Array.isArray(values) ? Number(values[0]) : Number.NaN;
                    if (Number.isInteger(nextIndex) && scenarioEntries.some(({ index }) => index === nextIndex)) {
                      onSelection(nextIndex);
                    }
                  }}
                />
              ) : (
                <Body1 className={styles.scenarioEmptyState}>
                  This Blueprint does not define any authored Scenarios.
                </Body1>
              )}
            </div>
          ) : rightTab === "journal" ? (
            <GikComponent
              kind="primitive:growing-container"
              id="scenario-journal"
              componentProps={{
                followEnd: "when-at-end",
                ariaLabel: "Scenario journal",
                style: { height: "100%" },
              }}
            >
              <div className={styles.journalContent}>
                {runnerMode === "acts" ? (
                  <ol className={styles.journalList} aria-label="Act journal">
                    {visibleActs.map((act) => (
                      <li
                        className={mergeClasses(
                          styles.journalCard,
                          act.globalIndex === cursor
                            && executionStatus !== "completed"
                            && styles.journalCardCurrent,
                        )}
                        key={act.id}
                      >
                        <div className={styles.journalCardHeader}>
                          <div className={styles.journalCardCopy}>
                            <strong>{act.title}</strong>
                            {act.description
                              ? <Caption1 className={styles.journalCardDescription}>{act.description}</Caption1>
                              : null}
                          </div>
                          <ActDetailPopover
                            act={act}
                            observation={actObservations[act.globalIndex]}
                          />
                        </div>
                        <span className={styles.journalCardIndex} aria-hidden="true">
                          {act.globalIndex + 1}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <ol className={styles.journalList} aria-label="Step journal">
                    {visibleSteps.map((step, stepIndex) => {
                      const stepActs = visibleActs.filter((act) => act.stepIndex === stepIndex);
                      return (
                        <li
                          className={mergeClasses(
                            styles.journalCard,
                            stepIndex === currentStepIndex
                              && executionStatus !== "completed"
                              && styles.journalCardCurrent,
                          )}
                          key={step.id}
                        >
                          <div className={styles.journalCardCopy}>
                            <strong>{step.title}</strong>
                            {step.description
                              ? <Caption1 className={styles.journalCardDescription}>{step.description}</Caption1>
                              : null}
                          </div>
                          {stepActs.length > 0 ? (
                            <ol className={styles.actRail} aria-label={`${step.title} acts`}>
                              {stepActs.map((act) => (
                                <li className={styles.actRailItem} key={act.id}>
                                  <span className={styles.actRailIcon}>
                                    <ActDetailPopover
                                      act={act}
                                      observation={actObservations[act.globalIndex]}
                                    />
                                  </span>
                                  <span>{act.title}</span>
                                </li>
                              ))}
                            </ol>
                          ) : null}
                          <span className={styles.journalCardIndex} aria-hidden="true">
                            {stepIndex + 1}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {error ? <Body1 className={styles.error}>{error}</Body1> : null}
              </div>
            </GikComponent>
          ) : rightTab === "context" ? (
            <div className={styles.context}>
              {applicableContextIds.length > 0 ? (
                <div
                  className={mergeClasses(styles.field, styles.pickerContainer)}
                  aria-label="Sample Contexts"
                >
                  <Label htmlFor="scenario-context-select">Sample Contexts</Label>
                  <Dropdown
                    id="scenario-context-select"
                    value={draftContextId
                      ? entry.document.contextPresets[draftContextId]?.label ?? draftContextId
                      : "Custom"}
                    selectedOptions={draftContextId ? [draftContextId] : []}
                    disabled={running}
                    onOptionSelect={(_, data) => choosePreset(String(data.optionValue))}
                  >
                    {applicableContextIds.map((id) => (
                      <Option key={id} value={id}>
                        {entry.document.contextPresets[id]?.label ?? id}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
              ) : null}
              {contextFormSpec ? (
                <GikComponent
                  kind="primitive:form"
                  id={`scenario-context-form:${entry.document.blueprint}`}
                  data={contextDraft as Record<string, Json>}
                  componentProps={{
                    fields: contextFormSpec.fields as unknown as Json,
                    saveLabel: contextFormSpec.saveLabel ?? "Apply",
                    discardLabel: contextFormSpec.discardLabel ?? "Discard",
                  }}
                  onEvent={(event) => {
                    if (running) return;
                    if (event.name === "discard") {
                      setContextDraft(structuredClone(appliedContext));
                      setDraftContextId(appliedContextId);
                    } else if (event.name === "save") {
                      const values = event.payload.values;
                      if (values && typeof values === "object" && !Array.isArray(values)) {
                        applyContext(values as ExternalContext);
                      }
                    }
                  }}
                />
              ) : (
                <Body1>This Blueprint does not declare a context form.</Body1>
              )}
            </div>
          ) : null}
            </div>
          </div>
        </PaneWithTriggerBody>
        {entry.authored ? <PaneWithTriggerFooter>
          <div className={styles.timerControls}>
            <div className={styles.timerAction}>
              <ToggleButton
                className={styles.paceToggle}
                checked={timerPace === "presenter"}
                disabled={running}
                icon={timerPace === "presenter" ? <PresenterRegular /> : <TimerRegular />}
                aria-label={timerPace === "presenter"
                  ? "Use automatic pace"
                  : "Use presenter pace"}
                title={timerPace === "presenter"
                  ? "Presenter pace · 02:00"
                  : "Automatic pace · 00:02"}
                onClick={toggleTimerPace}
              />
              <GikComponent
                kind="primitive:timer-button"
                id="scenario-run-timer"
                componentProps={{
                  label: timerLabel,
                  ariaLabel: `${timerLabel} now`,
                  variant: "auto-only",
                  durationMs: cursor >= acts.length ? 0 : timerDurationMs,
                  autoStart: !timerPaused,
                  triggerImmediately: runnerMode === "steps"
                    && Boolean(currentAct && ("wait" in currentAct || "observe" in currentAct)),
                  repeat: Boolean(currentAct && "wait" in currentAct),
                  showCountdown: true,
                  countdownOnly: true,
                  resetKey: `${cursor}:${timerPace}:${timerEpoch}`,
                  disabled: running || cursor >= acts.length,
                  appearance: "primary",
                }}
                onEvent={(event) => {
                  if (event.name === "press") void runCurrentAct();
                }}
              />
            </div>
            <div className={styles.timerUtilities}>
              <GikComponent
                kind="fluent:toggle"
                id="scenario-journal-mode"
                componentProps={{
                  value: runnerMode,
                  onValue: "acts",
                  offValue: "steps",
                  onLabel: "Acts",
                  offLabel: "Steps",
                  onIcon: "acts",
                  offIcon: "steps",
                  onTitle: "Acts view · switch to steps",
                  offTitle: "Steps view · switch to acts",
                  ariaLabel: "Show Scenario journal by steps or acts",
                  size: "small",
                }}
                onEvent={(event) => {
                  if (event.name === "toggle") {
                    setRunnerMode(event.payload.value === "acts" ? "acts" : "steps");
                  }
                }}
              />
              <Button
                appearance="subtle"
                size="small"
                icon={timerPaused ? <PlayRegular /> : <PauseRegular />}
                aria-label={timerPaused ? "Resume Scenario" : "Pause Scenario"}
                title={timerPaused ? "Resume Scenario" : "Pause Scenario"}
                disabled={cursor >= acts.length}
                onClick={timerPaused ? () => setTimerPaused(false) : stop}
              />
              <Button
                appearance="subtle"
                size="small"
                icon={<ArrowResetRegular />}
                aria-label="Reset Scenario"
                title="Reset Scenario"
                disabled={running}
                onClick={reset}
              />
            </div>
          </div>
        </PaneWithTriggerFooter> : null}
      </GikComponent>
    </>
  );
}
