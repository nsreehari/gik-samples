import React from "react";
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Dropdown,
  Label,
  Option,
  Subtitle1,
  Tab,
  TabList,
  makeStyles,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from "@fluentui/react-components";
import {
  DataTrendingRegular,
  WindowRegular,
} from "@fluentui/react-icons";
import { GikComponent } from "@gik/components";
import {
  materializeBlueprint,
  parseBlueprintReference,
  runMaterializedTransition,
  type ExternalContext,
  type MaterializedBlueprint,
} from "@gik/blueprint";
import type { GIKEvent, Json, Orchestrator, StateModel } from "@gik/kernel";
import { buildCapabilityCatalogFromExternals, type BundleNative } from "@gik/react";

import {
  getSampleBlueprintCatalog,
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
import { BlueprintSnapshotView } from "./BlueprintSnapshotView";
import { useBlueprintHostSetup } from "./blueprint-host-setup";
import {
  readScenarioQuery,
  writeScenarioQuery,
} from "./host-query";
import {
  resolveCapabilityDescriptors,
} from "./runtime/provider-registry";

interface ScenarioEntry {
  document: ScenarioDocument;
  scenario: ScenarioDefinition;
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
    gap: tokens.spacingVerticalXS,
  },
  progressSummary: {
    display: "grid",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  progressHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  progressDetail: {
    display: "grid",
    gap: tokens.spacingVerticalXXS,
  },
  timerControls: {
    display: "grid",
    gap: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  timerAction: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  observations: {
    display: "grid",
    gap: tokens.spacingVerticalS,
  },
  observation: {
    display: "grid",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  observationValues: {
    margin: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  surface: {
    position: "absolute",
    inset: 0,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: tokens.colorNeutralBackground1,
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
  drawer: { display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", minHeight: 0, height: "100%" },
  drawerTabs: { marginBottom: tokens.spacingVerticalM },
  drawerPanel: { minHeight: 0, overflow: "auto", paddingRight: tokens.spacingHorizontalXS },
  context: {
    display: "grid",
    alignContent: "start",
    gap: tokens.spacingVerticalM,
  },
  error: { color: tokens.colorPaletteRedForeground1 },
  presentation: { minHeight: "100%", minWidth: 0 },
});

function defaultContextId(entry: ScenarioEntry, requested?: string): string {
  const applicable = entry.scenario.applicableContexts
    ?? Object.keys(entry.document.contextPresets);
  if (requested && applicable.includes(requested)) return requested;
  return entry.scenario.contextPreset ?? applicable[0] ?? "";
}

function contextMatches(
  context: ExternalContext,
  preset: ExternalContext,
): boolean {
  return JSON.stringify(context) === JSON.stringify(preset);
}

function transitionOrchestrator(
  native: BundleNative,
): ((state: StateModel) => Orchestrator) | undefined {
  return native.wrapOrchestrator
    ? (state) => native.wrapOrchestrator!({}, state)
    : undefined;
}

export function ScenarioExplorerPage(): React.ReactElement {
  const styles = useStyles();
  const entries = React.useMemo(
    () => Object.values(getSampleBlueprintCatalog().scenarios).flatMap((document) =>
      document.scenarios.map((scenario) => ({ document, scenario }))),
    [],
  );
  if (entries.length === 0) throw new Error("The Scenario Explorer requires at least one scenario.");
  const initialQuery = React.useMemo(
    () => typeof window === "undefined" ? {} : readScenarioQuery(window.location.search),
    [],
  );
  const initialSelection = Math.max(0, entries.findIndex(({ document, scenario }) =>
    document.blueprint === initialQuery.blueprintId
    && scenario.id === initialQuery.scenarioId));
  const [selection, setSelection] = React.useState(initialSelection);
  const entry = entries[selection] ?? entries[0];

  return (
    <main className={styles.page}>
      <ScenarioWorkspace
        key={`${entry.document.blueprint}:${entry.scenario.id}`}
        entry={entry}
        entries={entries}
        selection={selection}
        onSelection={setSelection}
        requestedContextId={initialQuery.contextId}
      />
    </main>
  );
}

function ScenarioWorkspace({
  entry,
  entries,
  selection,
  onSelection,
  requestedContextId,
}: {
  entry: ScenarioEntry;
  entries: ScenarioEntry[];
  selection: number;
  onSelection(value: number): void;
  requestedContextId?: string;
}): React.ReactElement {
  const styles = useStyles();
  const initialContextId = defaultContextId(entry, requestedContextId);
  const initialContext = structuredClone(
    entry.document.contextPresets[initialContextId]?.context ?? {},
  );
  const [appliedContext, setAppliedContext] = React.useState<ExternalContext>(initialContext);
  const [contextDraft, setContextDraft] = React.useState<ExternalContext>(initialContext);
  const [appliedContextId, setAppliedContextId] = React.useState<string | undefined>(initialContextId || undefined);
  const [draftContextId, setDraftContextId] = React.useState<string | undefined>(initialContextId || undefined);
  const [runnerMode, setRunnerMode] = React.useState<RunnerMode>("steps");
  const [timerPace, setTimerPace] = React.useState<TimerPace>("automatic");
  const [rightTab, setRightTab] = React.useState("steps");
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

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const url = writeScenarioQuery(window.location.href, {
      blueprintId: entry.document.blueprint,
      scenarioId: entry.scenario.id,
      ...(appliedContextId ? { contextId: appliedContextId } : {}),
    });
    if (url !== window.location.href) window.history.replaceState(null, "", url);
  }, [appliedContextId, entry.document.blueprint, entry.scenario.id]);

  const runTransition = React.useCallback(async (event: GIKEvent): Promise<Record<string, Json>> => {
    const currentMaterialization = materializedRef.current;
    const result = await runMaterializedTransition({
      state: stateRef.current,
      materializedBlueprint: currentMaterialization,
      events: [event],
      createOrchestrator: transitionOrchestrator(nativeRef.current),
    });
    return result.state;
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
      commitState(structuredClone(materializedBlueprint.payload.initialState));
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
      .find(([, preset]) => contextMatches(values, preset.context))?.[0];
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
      status: statuses.includes("failed")
        ? "failed"
        : stepIndex < currentStepIndex
          ? "completed"
          : stepIndex === currentStepIndex && executionStatus !== "completed"
            ? "current"
            : "upcoming",
    };
  });
  const onTab = (setter: (value: string) => void) =>
    (_: SelectTabEvent, data: SelectTabData) => setter(String(data.value));
  const selectControlTab = (_: SelectTabEvent, data: SelectTabData) => {
    const value = String(data.value);
    setRightTab(value);
    if (value === "steps" || value === "acts") setRunnerMode(value);
  };

  return (
    <>
      <section className={styles.surface} aria-label="Scenario Blueprint">
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
          <GikComponent
            kind="primitive:infinite-canvas"
            id={`scenario-data-flow:${entry.document.blueprint}`}
            componentProps={{
              stateKey: `scenario-data-flow:${entry.document.blueprint}`,
              nodes: dataFlow.nodes as unknown as Json,
              nodePorts: dataFlow.nodePorts as unknown as Json,
              height: "100%",
              controls: true,
              miniMap: true,
              selectionOnDrag: false,
              ariaLabel: `${entry.scenario.title} Blueprint Cell data flow`,
            }}
          />
        )}
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
          style: { top: "50px", bottom: "50px" },
        }}
      >
        <div className={styles.drawer}>
          <div className={styles.runnerIntro}>
            <Subtitle1>{entry.scenario.title}</Subtitle1>
            <Caption1>{entry.scenario.description ?? "Run Blueprint events against the current materialization."}</Caption1>
            <div className={styles.field}>
              <Label htmlFor="scenario-select">Scenario</Label>
              <Dropdown
                id="scenario-select"
                value={entry.scenario.title}
                selectedOptions={[String(selection)]}
                disabled={running}
                onOptionSelect={(_, data) => onSelection(Number(data.optionValue))}
              >
                {entries.map((candidate, index) => (
                  <Option key={`${candidate.document.blueprint}:${candidate.scenario.id}`} value={String(index)}>
                    {candidate.scenario.title}
                  </Option>
                ))}
              </Dropdown>
            </div>
          </div>
          <TabList className={styles.drawerTabs} selectedValue={rightTab} onTabSelect={selectControlTab}>
            <Tab value="steps">Steps</Tab>
            <Tab value="acts">Acts</Tab>
            <Tab value="context">Context</Tab>
          </TabList>
          <div className={styles.drawerPanel}>
          {rightTab === "steps" || rightTab === "acts" ? (
            <div className={styles.runner}>
              <div className={styles.progressSummary} aria-live="polite">
                <div className={styles.progressHeader}>
                  <strong>
                    {executionStatus === "completed"
                      ? "Scenario complete"
                      : rightTab === "steps"
                        ? `Step ${currentStepIndex + 1} of ${entry.scenario.steps.length}`
                        : `Act ${cursor + 1} of ${acts.length}`}
                  </strong>
                  <Badge color={executionStatus === "failed" ? "danger" : executionStatus === "completed" ? "success" : "informative"}>
                    {executionStatus}
                  </Badge>
                </div>
                <GikComponent
                  kind="semantic:process"
                  id="scenario-step-progress"
                  data={stepProgressItems as unknown as Json}
                  variant="progress"
                  componentProps={{
                    spec: {
                      fields: {
                        id: "id",
                        title: "title",
                        order: "order",
                        status: "status",
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
                {executionStatus !== "completed" ? (
                  <div className={styles.progressDetail}>
                    <strong>{rightTab === "steps" ? currentStep?.title : currentAct?.title}</strong>
                    {rightTab === "steps" ? (
                      currentStep?.description ? <Caption1>{currentStep.description}</Caption1> : null
                    ) : (
                      <>
                        <Caption1>{running ? "Running" : "Next"} in {currentAct?.stepTitle}</Caption1>
                        {currentAct && "event" in currentAct ? (
                          <Caption1>{currentAct.event.node} / {currentAct.event.name}</Caption1>
                        ) : currentAct && "wait" in currentAct ? (
                          <Caption1>
                            Check until true: {currentAct.wait.when}
                          </Caption1>
                        ) : currentAct ? (
                          <Caption1>
                            Observe {Object.keys(currentAct.observe.select).join(", ")}
                          </Caption1>
                        ) : null}
                        {currentAct?.description ? <Caption1>{currentAct.description}</Caption1> : null}
                      </>
                    )}
                  </div>
                ) : null}
                {rightTab === "acts" && Object.keys(actObservations).length > 0 ? (
                  <div className={styles.observations}>
                    {Object.entries(actObservations).map(([index, values]) => (
                      <div className={styles.observation} key={index}>
                        <strong>{acts[Number(index)]?.title}</strong>
                        <pre className={styles.observationValues}>{JSON.stringify(values, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className={styles.timerControls}>
                <div className={styles.field}>
                  <Label htmlFor="runner-pace">Timer pace</Label>
                  <Dropdown
                    id="runner-pace"
                    value={timerPace === "automatic" ? "Automatic · 2 seconds" : "Presenter · 2 minutes"}
                    selectedOptions={[timerPace]}
                    disabled={running}
                    onOptionSelect={(_, data) => {
                      const value = String(data.optionValue);
                      if (value === "automatic" || value === "presenter") {
                        setTimerPace(value);
                        setTimerPaused(false);
                      }
                    }}
                  >
                    <Option value="automatic">Automatic · 2 seconds</Option>
                    <Option value="presenter">Presenter · 2 minutes</Option>
                  </Dropdown>
                  <Caption1>
                    The presenter pace still advances automatically, but leaves time to trigger the action directly.
                  </Caption1>
                </div>
                <div className={styles.timerAction}>
                  <GikComponent
                    kind="primitive:timer-button"
                    id="scenario-run-timer"
                    componentProps={{
                      label: timerLabel,
                      ariaLabel: `${timerLabel} now`,
                      variant: "auto-only",
                      durationMs: timerDurationMs,
                      autoStart: !timerPaused,
                      triggerImmediately: Boolean(currentAct && ("wait" in currentAct || "observe" in currentAct)),
                      repeat: Boolean(currentAct && "wait" in currentAct),
                      showCountdown: true,
                      resetKey: `${cursor}:${timerPace}:${timerEpoch}`,
                      disabled: running || cursor >= acts.length,
                      appearance: "primary",
                    }}
                    onEvent={(event) => {
                      if (event.name === "press") void runCurrentAct();
                    }}
                  />
                  {timerPaused ? (
                    <Button
                      disabled={running || cursor >= acts.length}
                      onClick={() => setTimerPaused(false)}
                    >
                      Resume timer
                    </Button>
                  ) : (
                    <Button disabled={cursor >= acts.length} onClick={stop}>Stop</Button>
                  )}
                </div>
                <div className={styles.actions}>
                  <Button disabled={running} onClick={reset}>Reset</Button>
                </div>
              </div>
              {error ? <Body1 className={styles.error}>{error}</Body1> : null}
            </div>
          ) : rightTab === "context" ? (
            <div className={styles.context}>
              {applicableContextIds.length > 0 ? (
                <div className={styles.field}>
                  <Label htmlFor="scenario-context-select">Preset quick-fill</Label>
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
              <Caption1>
                Applying context rematerializes the Blueprint while preserving state and runner position.
              </Caption1>
            </div>
          ) : null}
          </div>
        </div>
      </GikComponent>
    </>
  );
}
