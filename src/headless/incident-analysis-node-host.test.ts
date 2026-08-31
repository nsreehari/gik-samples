import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  materializeBlueprint,
  parseBlueprintReference,
} from "@gik-ai/blueprint";
import { executeQueuedCellSourceEffect } from "@gik-ai/blueprint/worker";
import { evalAsyncJsonata, runDeclarativeValidators } from "@gik-ai/evaluators";
import type { Json, ResolvedNode } from "@gik-ai/kernel";
import { BlueprintController } from "@gik-ai/react";

import { resolveSampleBlueprintSource } from "../bootstrap/catalog/blueprint-catalog";

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
assert.equal(typeof sourceReport, "string");
assert.ok(savedEnvelope);
const generatedReport = savedEnvelope.analysisReport;
assert.ok(generatedReport);

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

test("Node host carries an Incident Analysis response through cache update to report-viewer", async () => {
  const blueprint = resolveSampleBlueprintSource("incident-analysis-new-shell");
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
  const validation = runDeclarativeValidators(
    blueprint.payload.cells["incident-analysis"].sources?.[0]?.acceptanceCriteria ?? [],
    templatedReport,
  );
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
  const emptyReport = await evalAsyncJsonata(responseTransform.expr, {
    response: { markdown: "" },
  });
  const emptyValidation = runDeclarativeValidators(
    blueprint.payload.cells["incident-analysis"].sources?.[0]?.acceptanceCriteria ?? [],
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
          return executeQueuedCellSourceEffect(effect, state.snapshot(), (executingEffect) => {
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

    await controller.emit("cache-envelope-retrieve--primary--in-analyze-button", "press", {});
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
