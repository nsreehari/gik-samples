import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  materializeBlueprint,
  parseBlueprintReference,
} from "@gik-ai/blueprint";
import { executeQueuedCellSourceEffect } from "@gik-ai/blueprint/worker";
import { evalAsyncJsonata, runDeclarativeValidators } from "@gik-ai/evaluators";
import type { Json, OrchestratorResult, ResolvedNode } from "@gik-ai/kernel";
import { BlueprintController } from "@gik-ai/react";

import { resolveSampleBlueprintSource } from "../bootstrap/catalog/blueprint-catalog";
import {
  closeAgentResponseWorkspace,
  composeAgentResponse,
  createAgentResponseTools,
  openAgentResponseWorkspace,
  parseAgentResponseWorkspaceSpec,
  readAgentResponseProposal,
} from "../service-kinds/agent-response-workspace";

const bootstrapAssets = JSON.parse(readFileSync(
  new URL(
    "../bootstrap/blueprints/incident-analysis-assets/bootstrap-assets/catalog.json",
    import.meta.url,
  ),
  "utf8",
)) as { records: Array<{ key: string; value: Record<string, Json> }> };
const sourceReport = bootstrapAssets.records.find(({ key }) =>
  key === "source:password-spray-mailbox")?.value.content;
const savedEnvelope = bootstrapAssets.records.find(({ key }) =>
  key === "seed-asset:password-spray-mailbox/semantic")?.value;
assert.ok(typeof sourceReport === "string");
assert.ok(savedEnvelope);
const generatedReport = savedEnvelope.analysisReport;
assert.ok(generatedReport);

const fixedPresentationCapabilities = [
  "semantic:decision",
  "semantic:narrative",
  "security:attack-path",
  "semantic:event-series",
  "semantic:entity-set",
  "semantic:evidence-case",
];
const fixedPresentationRegions = [
  "header",
  "verdict",
  "summary",
  "attack-graph",
  "correlated-alerts",
  "timeline",
  "compromised-entities",
  "ttps-and-key-activities",
  "iocs",
  "recommended-actions",
];

function fixedPresentationReport(): Record<string, Json> {
  const capabilities = [
    "semantic:narrative",
    "semantic:decision",
    "semantic:narrative",
    "security:attack-path",
    "semantic:evidence-case",
    "semantic:event-series",
    "semantic:entity-set",
    "semantic:entity-set",
    "semantic:entity-set",
    "semantic:narrative",
  ];
  const views = Object.fromEntries(fixedPresentationRegions.map((region, index) => [
    region,
    {
      capability: capabilities[index],
      bindings: {},
      region,
    },
  ]));
  const slots = [
    "report",
    ...fixedPresentationRegions.map((id) => ({ id, region: "report" })),
  ];
  return {
    gik: "0.1",
    type: "blueprint",
    payload: {
      id: "generated-incident-report",
      kind: "semantic-report",
      version: "1.0.0",
      structureMode: "fixed",
      serviceTiers: [{ id: "runtime-document", kind: "runtime-document" }],
      serviceRecipes: [],
      projectionTiers: [{
        id: "runtime-document",
        kind: "runtime-document",
        capabilities: fixedPresentationCapabilities,
      }],
      projectionRecipes: [],
      cells: { report: { id: "report", potentialViews: views } },
      runtime: {
        externals: {
          projectionViews: {
            semantic: {
              from: "semantic",
              use: ["decision", "narrative", "event-series", "entity-set", "evidence-case"],
            },
            security: { from: "security", use: ["attack-path"] },
          },
        },
        state: { report: {} },
      },
      presentation: {
        slots,
        root: "report",
        allowedCapabilities: fixedPresentationCapabilities,
      },
    },
  };
}

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}

function flatten(node: ResolvedNode): ResolvedNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

test("Fixed-presentation analysis requests and accepts one inert multi-view report Cell", async () => {
  const blueprint = resolveSampleBlueprintSource("incident-analysis-new-shell");
  assert.ok(blueprint.payload.cells);
  const source = blueprint.payload.cells["incident-analysis"].sources?.find(({ id }) =>
    id === "incident-analysis.fixed-presentation-source");
  assert.ok(source?.input);
  const service = blueprint.payload.services?.["incident-report-fixed-presentation"];
  assert.ok(service && "kind" in service);
  const requestTransform = service.operations.authorReportBlueprint.request?.transform;
  assert.ok(requestTransform);

  const sourceInput = await evalAsyncJsonata(source.input.expr, {
    inputs: {
      selectedSourceContent: sourceReport,
      selectedModel: "fixed-presentation",
    },
  }) as Record<string, Json>;
  const request = await evalAsyncJsonata(requestTransform.expr, {
    input: sourceInput,
  }) as Record<string, Json>;

  assert.equal(request.agentName, "Incident-Report-Fixed-Presentation-Agent");
  assert.equal(request.presentationMode, "fixed-presentation");
  assert.deepEqual(request.acceptedCapabilities, fixedPresentationCapabilities);
  assert.doesNotMatch(JSON.stringify(request.acceptedCapabilities), /primitive:markdown/);
  assert.match(String(request.instructions), /authoritative requirements for this invocation/);
  assert.doesNotMatch(String(request.instructions), /compose_response_set_in_progress_proposal/);
  assert.doesNotMatch(String(request.instructions), /compose_response_validate/);
  assert.doesNotMatch(String(request.instructions), /compose_response_simulate/);
  assert.deepEqual(
    ((request.authoringBrief as Record<string, Json>).blueprintProfile as Record<string, Json>)
      .presentation,
    { root: "report", sectionRegions: fixedPresentationRegions },
  );
  const scaffold = ((request.authoringBrief as Record<string, Json>).blueprintProfile as Record<string, Json>)
    .artifactScaffold as Record<string, Json>;
  const scaffoldPayload = scaffold.payload as Record<string, Json>;
  assert.deepEqual(Object.keys(scaffoldPayload.cells as Record<string, Json>), ["report"]);
  assert.deepEqual((scaffoldPayload.runtime as Record<string, Json>).externals, { projectionViews: {} });
  const authoringWorkspace = request.authoringWorkspace as Record<string, Json>;
  assert.deepEqual(authoringWorkspace.scaffold, scaffold);
  assert.deepEqual(authoringWorkspace.slots, [
    { field: "potentialViews", pointer: "/payload/cells/report/potentialViews" },
    { field: "reportState", pointer: "/payload/runtime/state/report" },
  ]);

  const report = fixedPresentationReport();
  const workspaceSpec = parseAgentResponseWorkspaceSpec(request.authoringWorkspace);
  assert.ok(workspaceSpec);
  const expectedPayload = report.payload as Record<string, Json>;
  const expectedCells = expectedPayload.cells as Record<string, Record<string, Json>>;
  const composedReport = composeAgentResponse(workspaceSpec, {
    potentialViews: expectedCells.report.potentialViews,
    reportState: ((expectedPayload.runtime as Record<string, Json>).state as Record<string, Json>).report,
  });
  const composedPayload = composedReport.payload as unknown as Record<string, Json>;
  const composedCells = composedPayload.cells as Record<string, Record<string, Json>>;
  assert.deepEqual(composedCells.report.potentialViews, expectedCells.report.potentialViews);
  assert.deepEqual(
    ((composedPayload.runtime as Record<string, Json>).state as Record<string, Json>).report,
    ((expectedPayload.runtime as Record<string, Json>).state as Record<string, Json>).report,
  );
  assert.deepEqual(
    ((composedPayload.runtime as Record<string, Json>).externals as Record<string, Json>).projectionViews,
    {
      semantic: {
        from: "semantic",
        use: ["narrative", "decision", "evidence-case", "event-series", "entity-set"],
      },
      security: { from: "security", use: ["attack-path"] },
    },
  );
  assert.throws(
    () => composeAgentResponse(workspaceSpec, {
      potentialViews: expectedCells.report.potentialViews,
      reportState: {},
      services: {},
    }),
    /unexpected fields: services/,
  );
  const proposalScope = "fixed-presentation-test";
  openAgentResponseWorkspace(proposalScope, workspaceSpec);
  try {
    const tools = Object.fromEntries(createAgentResponseTools().map((tool) => [tool.name, tool]));
    const fragmentJson = JSON.stringify({
      potentialViews: expectedCells.report.potentialViews,
      reportState: ((expectedPayload.runtime as Record<string, Json>).state as Record<string, Json>).report,
    });
    const context = { requestId: proposalScope };
    const validated = await tools.compose_response_validate.handler({ fragmentJson }, context);
    assert.equal((validated as Record<string, Json>).ok, true);
    const simulated = await tools.compose_response_simulate.handler({ fragmentJson }, context);
    assert.equal((simulated as Record<string, Json>).ok, true);
    await tools.compose_response_set_in_progress_proposal.handler({ fragmentJson }, context);
    const stored = await tools.compose_response_read_in_progress_proposal.handler({}, context);
    assert.deepEqual(stored, readAgentResponseProposal(proposalScope));
  } finally {
    closeAgentResponseWorkspace(proposalScope);
  }

  const validation = runDeclarativeValidators(
    source.acceptanceCriteria ?? [],
    report,
    { bindings: { request } },
  );
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));

  const payload = report.payload as Record<string, Json>;
  const cells = payload.cells as Record<string, Json>;
  const reportCell = cells.report as Record<string, Json>;
  const views = reportCell.potentialViews as Record<string, Record<string, Json>>;
  assert.deepEqual(Object.keys(cells), ["report"]);
  assert.deepEqual(
    Object.values(views).map(({ region }) => region),
    fixedPresentationRegions,
  );
  assert.ok(Object.values(views).every(({ capability }) =>
    fixedPresentationCapabilities.includes(String(capability))));

  const invalid = structuredClone(report);
  const invalidPayload = invalid.payload as Record<string, Json>;
  const invalidCells = invalidPayload.cells as Record<string, Json>;
  invalidCells.extra = { id: "extra" };
  const invalidValidation = runDeclarativeValidators(
    source.acceptanceCriteria ?? [],
    invalid,
    { bindings: { request } },
  );
  assert.equal(invalidValidation.ok, false);
  assert.ok(invalidValidation.errors.some(({ code }) =>
    code === "incident-report-fixed-presentation-shape"));

  const extraTier = structuredClone(report);
  const extraTierPayload = extraTier.payload as Record<string, Json>;
  const extraTiers = extraTierPayload.projectionTiers as Array<Record<string, Json>>;
  extraTiers.push({ id: "extra", kind: "runtime-document", capabilities: [] });
  const extraTierValidation = runDeclarativeValidators(
    source.acceptanceCriteria ?? [],
    extraTier,
    { bindings: { request } },
  );
  assert.equal(extraTierValidation.ok, false);
  assert.ok(extraTierValidation.errors.some(({ code }) =>
    code === "incident-report-projection-capability-ownership"));

});

test("Node host carries an Incident Analysis response through cache update to report-viewer", async () => {
  const blueprint = resolveSampleBlueprintSource("incident-analysis-new-shell");
  assert.ok(blueprint.payload.cells);
  const analysisService = blueprint.payload.services?.["incident-report-analysis"];
  assert.ok(analysisService && "kind" in analysisService);
  const responseTransform = analysisService.operations.analyzeReportBlueprint.response?.transform;
  assert.ok(responseTransform);
  const generatedPayload = generatedReport as Record<string, Json>;
  const generatedRuntime = generatedPayload.payload as Record<string, Json>;
  const runtime = generatedRuntime.runtime as Record<string, Json>;
  const runtimeState = runtime.state as Record<string, Json>;
  const reportState = runtimeState.report as Record<string, Json>;
  const templatedReport = await evalAsyncJsonata(responseTransform.expr, {
    response: { markdown: reportState.markdown },
  });
  assert.deepEqual(templatedReport, generatedReport);
  const templatedLegacyResponse = await evalAsyncJsonata(responseTransform.expr, {
    response: generatedReport,
  });
  assert.deepEqual(templatedLegacyResponse, generatedReport);
  const semanticSource = blueprint.payload.cells["incident-analysis"].sources?.find(({ id }) =>
    id === "incident-analysis.source");
  assert.ok(semanticSource);
  const validation = runDeclarativeValidators(
    semanticSource.acceptanceCriteria ?? [],
    templatedReport,
  );
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
  const emptyReport = await evalAsyncJsonata(responseTransform.expr, {
    response: { markdown: "" },
  });
  const emptyValidation = runDeclarativeValidators(
    semanticSource.acceptanceCriteria ?? [],
    emptyReport,
  );
  assert.equal(emptyValidation.ok, false);
  assert.ok(emptyValidation.errors.some(({ code }) => code === "incident-report-markdown"));

  const materializedBlueprint = materializeBlueprint({
    blueprint,
    resolveBlueprint(reference) {
      return resolveSampleBlueprintSource(parseBlueprintReference(reference).id);
    },
  });
  const invoked: string[] = [];
  const controller = new BlueprintController(blueprint, {
    materializedBlueprint,
    native: {
      wrapOrchestrator: (fallback, state) => ({
        ...fallback,
        invoke: async (effect, control) => {
          if (effect.kind !== "invoke" || !effect.control.sourceId) {
            return fallback?.invoke?.(effect, control);
          }
          invoked.push(effect.control.tool);
          return executeQueuedCellSourceEffect(effect, state.snapshot(), (executingEffect): OrchestratorResult => {
            if (executingEffect.kind !== "invoke" || !("tool" in executingEffect.control)) {
              throw new Error(`Unexpected Node-host effect '${executingEffect.kind}'`);
            }
            const data = executingEffect.data as Record<string, Json>;
            switch (executingEffect.control.tool) {
              case "listSourceReports":
                return { sourceOutput: { sources: [{ id: "password-spray-mailbox", label: "Password spray" }] } };
              case "getSourceReport":
                return { sourceOutput: { content: sourceReport } };
              case "getSavedReport":
                return { sourceOutput: null };
              case "analyzeReportBlueprint":
                return { sourceOutput: templatedReport };
              case "putSavedReport":
                return {
                  sourceOutput: {
                    analysisReport: data.analysis_response,
                    asOn: data.as_on,
                    asOnStamp: data.as_on_stamp,
                  },
                };
              default:
                throw new Error(`Unexpected Node-host service operation '${executingEffect.control.tool}'`);
            }
          });

        },
      }),
    },
  });

  try {
    await controller.start();
    await eventually(() => {
      assert.ok(invoked.includes("listSourceReports"));
    });

    await controller.emit("analysis-params--primary--in-params-form", "save", {
      values: { source: "password-spray-mailbox", model: "refinement" },
    });
    await eventually(() => {
      assert.ok(invoked.includes("getSourceReport"));
      assert.ok(invoked.includes("getSavedReport"));
    });
    assert.equal(invoked.filter((operation) => operation === "analyzeReportBlueprint").length, 0);
    assert.equal((controller.getState().incident as Record<string, Json>).refresherStamp, 0);

    const readyTree = await controller.settle();
    const analyzeButton = flatten(readyTree).find(({ id }) =>
      id === "incident-analysis--request--in-analysis-report");
    const analysisSpinner = flatten(readyTree).find(({ id }) =>
      id === "incident-analysis--progress--in-analysis-report");
    assert.equal(analyzeButton?.visible, true);
    assert.equal(analysisSpinner?.visible, false);

    await controller.emit("incident-analysis--request--in-analysis-report", "press", {});
    await eventually(() => {
      assert.ok(invoked.includes("analyzeReportBlueprint"));
      assert.ok(
        invoked.includes("putSavedReport"),
        JSON.stringify({ invoked, state: controller.getState() }, null, 2),
      );
      const envelope = controller.getState()["saved-report-envelope"] as Record<string, Json>;
      assert.equal(envelope.found, true);
      assert.deepEqual(envelope.analysisReport, generatedReport);
    });
    assert.equal(invoked.filter((operation) => operation === "analyzeReportBlueprint").length, 1);
    assert.equal((controller.getState().incident as Record<string, Json>).refresherStamp, 1);

    const tree = await controller.settle();
    const report = flatten(tree).find(({ id }) =>
      id === "report-viewer--primary--in-analysis-report");
    assert.ok(report);
    assert.equal(report.visible, true);
    assert.deepEqual(report.props.blueprint, generatedReport);
  } finally {
    controller.stop();
  }
});

test("Node host terminally settles a 429 after one configured source attempt", async () => {
  const blueprint = resolveSampleBlueprintSource("incident-analysis-new-shell");
  const materializedBlueprint = materializeBlueprint({
    blueprint,
    resolveBlueprint(reference) {
      return resolveSampleBlueprintSource(parseBlueprintReference(reference).id);
    },
  });
  let analysisAttempts = 0;
  const controller = new BlueprintController(blueprint, {
    materializedBlueprint,
    effectRetry: { maxAttempts: 1 },
    native: {
      wrapOrchestrator: (fallback, state) => ({
        ...fallback,
        invoke: async (effect, control) => {
          if (effect.kind !== "invoke" || !effect.control.sourceId) {
            return fallback?.invoke?.(effect, control);
          }
          return executeQueuedCellSourceEffect(effect, state.snapshot(), (executingEffect): OrchestratorResult => {
            if (executingEffect.kind !== "invoke" || !("tool" in executingEffect.control)) {
              throw new Error(`Unexpected Node-host effect '${executingEffect.kind}'`);
            }
            switch (executingEffect.control.tool) {
              case "listSourceReports":
                return { sourceOutput: { sources: [{ id: "password-spray-mailbox", label: "Password spray" }] } };
              case "getSourceReport":
                return { sourceOutput: { content: sourceReport } };
              case "getSavedReport":
                return { sourceOutput: null };
              case "analyzeReportBlueprint":
                analysisAttempts += 1;
                throw new Error("Too many requests");
              default:
                throw new Error(`Unexpected Node-host service operation '${executingEffect.control.tool}'`);
            }
          });
        },
      }),
    },
  });

  try {
    await controller.start();
    await controller.emit("analysis-params--primary--in-params-form", "save", {
      values: { source: "password-spray-mailbox", model: "refinement" },
    });
    await eventually(() => {
      const tree = controller.getTree();
      assert.ok(tree);
      const analyzeButton = flatten(tree).find(({ id }) =>
        id === "incident-analysis--request--in-analysis-report");
      assert.equal(analyzeButton?.visible, true);
    });

    await controller.emit("incident-analysis--request--in-analysis-report", "press", {});
    await eventually(() => {
      const tree = controller.getTree();
      assert.ok(tree);
      const analysisSpinner = flatten(tree).find(({ id }) =>
        id === "incident-analysis--progress--in-analysis-report");
      const analysisError = flatten(tree).find(({ id }) =>
        id === "incident-analysis--error--in-analysis-report");
      const analyzeButton = flatten(tree).find(({ id }) =>
        id === "incident-analysis--request--in-analysis-report");
      assert.equal(analysisAttempts, 1);
      assert.equal(analysisSpinner?.visible, false);
      assert.equal(analysisError?.visible, true);
      assert.equal(analysisError?.props.value, "Too many requests");
      assert.equal(analyzeButton?.visible, true);
    });
  } finally {
    controller.stop();
  }
});
