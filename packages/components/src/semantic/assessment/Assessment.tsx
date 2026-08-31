import React from "react";
import { Badge, Card, Divider, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { Json } from "@gik-ai/kernel";
import { runDeclarativeValidators } from "@gik-ai/evaluators";
import type { ProjectionView } from "@gik-ai/react";

import { asRecord, componentRootProps, componentStylePropsSchema, records, textAt, type BadgeColor } from "../../shared/component";
import { defineComponent, trialNode, type ComponentDescription, type ComponentValidationReport } from "../../shared/definition";

export const ASSESSMENT_SEMANTIC_TOKENS = ["ready", "not-ready", "attention", "unknown"] as const;
export const ASSESSMENT_VARIANTS = ["summary", "compact"] as const;
type AssessmentToken = typeof ASSESSMENT_SEMANTIC_TOKENS[number];
type AssessmentVariant = typeof ASSESSMENT_VARIANTS[number];

interface AssessmentSpec {
  emptyText?: string;
  fields: { title: string; status: string; summary: string; confidence?: string };
  checkFields?: { title: string; outcome: string; explanation?: string };
  toneMap?: Record<string, AssessmentToken>;
}

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#", type: "object", additionalProperties: false, required: ["assessment", "spec"],
  properties: {
    ...componentStylePropsSchema,
    assessment: { type: "object" }, checks: { type: "array", items: { type: "object" } },
    variant: { enum: ASSESSMENT_VARIANTS },
    spec: { type: "object", additionalProperties: false, required: ["fields"], properties: {
      emptyText: { type: "string" },
      fields: { type: "object", additionalProperties: false, required: ["title", "status", "summary"], properties: {
        title: { type: "string", minLength: 1 }, status: { type: "string", minLength: 1 }, summary: { type: "string", minLength: 1 }, confidence: { type: "string", minLength: 1 },
      } },
      checkFields: { type: "object", additionalProperties: false, required: ["title", "outcome"], properties: { title: { type: "string", minLength: 1 }, outcome: { type: "string", minLength: 1 }, explanation: { type: "string", minLength: 1 } } },
      toneMap: { type: "object", additionalProperties: { enum: ASSESSMENT_SEMANTIC_TOKENS } },
    } },
  },
} as const;

const useStyles = makeStyles({
  root: { display: "grid", gap: tokens.spacingVerticalM },
  summary: { color: tokens.colorNeutralForeground2 },
  checks: { display: "grid", gap: tokens.spacingVerticalS },
  check: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start", gap: tokens.spacingHorizontalM },
  explanation: { color: tokens.colorNeutralForeground3 },
});

function tone(token: AssessmentToken | undefined): BadgeColor {
  if (token === "ready") return "success";
  if (token === "not-ready") return "danger";
  if (token === "attention") return "warning";
  return "informative";
}

export const Assessment: ProjectionView = ({ node }) => {
  const styles = useStyles();
  const record = asRecord(node.props.assessment);
  const spec = (node.props.spec ?? {}) as unknown as AssessmentSpec;
  const variant = (node.props.variant ?? "summary") as AssessmentVariant;
  if (!spec.fields || Object.keys(record).length === 0) return <Text {...componentRootProps(node)}>{spec.emptyText ?? "No assessment available."}</Text>;
  const status = textAt(record, spec.fields.status);
  const token = spec.toneMap?.[status];
  const checks = records(node.props.checks);
  const root = componentRootProps(node, styles.root);
  return <Card {...root} appearance="outline">
    <Text weight="semibold" size={600}>{textAt(record, spec.fields.title)}</Text>
    <div><Badge appearance="filled" color={tone(token)}>{status}</Badge></div>
    <Text className={styles.summary}>{textAt(record, spec.fields.summary)}</Text>
    {spec.fields.confidence && textAt(record, spec.fields.confidence) ? <Text size={200}>Confidence: {textAt(record, spec.fields.confidence)}</Text> : null}
    {variant === "summary" && checks.length > 0 && spec.checkFields ? <>
      <Divider />
      <div className={styles.checks} aria-label="Contributing checks">{checks.map((check, index) => {
        const outcome = textAt(check, spec.checkFields!.outcome);
        const checkToken = spec.toneMap?.[outcome];
        return <div className={styles.check} key={index}>
          <div><Text weight="semibold">{textAt(check, spec.checkFields!.title)}</Text>{spec.checkFields!.explanation ? <Text block className={styles.explanation}>{textAt(check, spec.checkFields!.explanation)}</Text> : null}</div>
          <Badge appearance="tint" color={tone(checkToken)}>{outcome}</Badge>
        </div>;
      })}</div>
    </> : null}
  </Card>;
};

const description: ComponentDescription = {
  capability: "semantic:assessment", summary: "Presents an overall judgment with its status, summary, and contributing checks.", dataProp: "assessment", events: [], semanticTokens: ASSESSMENT_SEMANTIC_TOKENS, defaultVariant: "summary",
  variants: [
    { value: "summary", summary: "Overall judgment plus contributing checks and their outcomes.", useWhen: ["The reasoning behind the overall judgment matters"] },
    { value: "compact", summary: "Overall judgment only.", useWhen: ["The assessment appears in a scanning list"] },
  ],
  authoring: { useWhen: ["Several checks or factors are combined into one overall judgment"], avoidWhen: ["Only one finding or comparison is being presented"], rules: ["Map title, status, and summary fields for the overall judgment", "Map contributing checks with their own outcome and explanation", "Never infer overall status from checks; use the authored status"] },
};

export function getAssessmentSchema(): Record<string, unknown> { return schema as unknown as Record<string, unknown>; }
export function validateAssessment(props: unknown): ComponentValidationReport {
  return runDeclarativeValidators([{ kind: "ajv-schema", schema: getAssessmentSchema(), message: "Invalid semantic:assessment props", code: "assessment-schema" }], props as Json);
}
export function materializeAssessmentTrial() {
  return trialNode("semantic:assessment", {
    variant: "summary",
    assessment: { name: "Filing readiness", state: "not-ready", overview: "The account is not ready for filing because two required checks failed and one remains unresolved.", certainty: "high" },
    checks: [
      { name: "Lot allocation reconciles", result: "failed", note: "Allocated quantity does not equal sold quantity for sale:2026-013." },
      { name: "Cost basis complete", result: "failed", note: "lot:2025-011 has no recorded cost basis." },
      { name: "Broker statement matched", result: "pending", note: "Awaiting the September broker statement." },
    ],
    spec: { fields: { title: "name", status: "state", summary: "overview", confidence: "certainty" }, checkFields: { title: "name", outcome: "result", explanation: "note" }, toneMap: { "not-ready": "not-ready", ready: "ready", failed: "not-ready", passed: "ready", pending: "attention" } },
  });
}
export const assessmentDefinition = defineComponent({ description, version: "1.0.0", component: Assessment, getSchema: getAssessmentSchema, validate: validateAssessment, materializeTrial: materializeAssessmentTrial });
