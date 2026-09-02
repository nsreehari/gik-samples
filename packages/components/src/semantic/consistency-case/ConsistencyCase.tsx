import React from "react";
import { Badge, Card, Divider, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { Json } from "gik-kernel";
import { runDeclarativeValidators } from "gik-evaluators";
import type { ProjectionView } from "gik-react";

import { asRecord, componentRootProps, componentStylePropsSchema, records, textAt, type BadgeColor } from "../../shared/component";
import { defineComponent, trialNode, type ComponentDescription, type ComponentValidationReport } from "../../shared/definition";

export const CONSISTENCY_CASE_SEMANTIC_TOKENS = ["consistent", "contradictory", "ambiguous", "insufficient-information"] as const;
export const CONSISTENCY_CASE_VARIANTS = ["detailed", "compact"] as const;
type ConsistencyToken = typeof CONSISTENCY_CASE_SEMANTIC_TOKENS[number];
type ConsistencyCaseVariant = typeof CONSISTENCY_CASE_VARIANTS[number];

interface ConsistencyCaseSpec {
  title?: string;
  emptyText?: string;
  fields: { question: string; outcome: string; rationale: string; confidence?: string };
  subjectFields?: { label: string; detail?: string };
  toneMap?: Record<string, ConsistencyToken>;
}

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#", type: "object", additionalProperties: false, required: ["case", "spec"],
  properties: {
    ...componentStylePropsSchema,
    case: { type: "object" }, subjects: { type: "array", items: { type: "object" } }, evidence: { type: "array", items: { type: "string" } },
    variant: { enum: CONSISTENCY_CASE_VARIANTS },
    spec: { type: "object", additionalProperties: false, required: ["fields"], properties: {
      title: { type: "string" }, emptyText: { type: "string" },
      fields: { type: "object", additionalProperties: false, required: ["question", "outcome", "rationale"], properties: {
        question: { type: "string", minLength: 1 }, outcome: { type: "string", minLength: 1 }, rationale: { type: "string", minLength: 1 }, confidence: { type: "string", minLength: 1 },
      } },
      subjectFields: { type: "object", additionalProperties: false, required: ["label"], properties: { label: { type: "string", minLength: 1 }, detail: { type: "string", minLength: 1 } } },
      toneMap: { type: "object", additionalProperties: { enum: CONSISTENCY_CASE_SEMANTIC_TOKENS } },
    } },
  },
} as const;

const useStyles = makeStyles({
  root: { display: "grid", gap: tokens.spacingVerticalM },
  question: { color: tokens.colorNeutralForeground3 },
  rationale: { color: tokens.colorNeutralForeground2 },
  subjects: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: tokens.spacingHorizontalM },
  subject: { display: "grid", gap: tokens.spacingVerticalXXS },
  refs: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS },
});

function tone(token: ConsistencyToken | undefined): BadgeColor {
  if (token === "consistent") return "success";
  if (token === "contradictory") return "danger";
  if (token === "ambiguous") return "warning";
  return "informative";
}

export const ConsistencyCase: ProjectionView = ({ node }) => {
  const styles = useStyles();
  const record = asRecord(node.props.case);
  const spec = (node.props.spec ?? {}) as unknown as ConsistencyCaseSpec;
  const variant = (node.props.variant ?? "detailed") as ConsistencyCaseVariant;
  if (!spec.fields || Object.keys(record).length === 0) return <Text {...componentRootProps(node)}>{spec.emptyText ?? "No consistency case available."}</Text>;
  const outcome = textAt(record, spec.fields.outcome);
  const token = spec.toneMap?.[outcome];
  const subjects = records(node.props.subjects);
  const evidence = Array.isArray(node.props.evidence) ? node.props.evidence.map(String) : [];
  const root = componentRootProps(node, styles.root);
  return <Card {...root} appearance="outline">
    {spec.title ? <Text weight="semibold" size={200} className={styles.question}>{spec.title}</Text> : null}
    <Text weight="semibold" size={500}>{textAt(record, spec.fields.question)}</Text>
    <div><Badge appearance="filled" color={tone(token)}>{outcome}</Badge></div>
    {variant === "detailed" ? <>
      <Text className={styles.rationale}>{textAt(record, spec.fields.rationale)}</Text>
      {spec.fields.confidence && textAt(record, spec.fields.confidence) ? <Text size={200}>Confidence: {textAt(record, spec.fields.confidence)}</Text> : null}
      {subjects.length > 0 && spec.subjectFields ? <><Divider /><div className={styles.subjects} aria-label="Compared records">{subjects.map((subject, index) => <div className={styles.subject} key={index}><Text weight="semibold">{textAt(subject, spec.subjectFields!.label)}</Text>{spec.subjectFields!.detail ? <Text size={200}>{textAt(subject, spec.subjectFields!.detail)}</Text> : null}</div>)}</div></> : null}
      {evidence.length > 0 ? <div className={styles.refs} aria-label="Supporting evidence">{evidence.map((ref) => <Badge key={ref} appearance="ghost" shape="rounded">{ref}</Badge>)}</div> : null}
    </> : null}
  </Card>;
};

const description: ComponentDescription = {
  capability: "semantic:consistency-case", summary: "Presents whether compared records agree, contradict, or leave a question unresolved, and why.", dataProp: "case", events: [], semanticTokens: CONSISTENCY_CASE_SEMANTIC_TOKENS, defaultVariant: "detailed",
  variants: [
    { value: "detailed", summary: "Question, outcome, rationale, compared subjects, and evidence.", useWhen: ["Reviewers need the full comparison and its supporting detail"] },
    { value: "compact", summary: "Question and outcome only.", useWhen: ["The case appears in a scanning list"] },
  ],
  authoring: { useWhen: ["Two or more records or assertions are compared for agreement"], avoidWhen: ["A single record is being evaluated in isolation; use finding-set or assessment"], rules: ["Represent consistent, contradictory, ambiguous, and insufficient-information outcomes", "Preserve subject and evidence references as authored data", "Never infer an outcome the authored data does not state"] },
};

export function getConsistencyCaseSchema(): Record<string, unknown> { return schema as unknown as Record<string, unknown>; }
export function validateConsistencyCase(props: unknown): ComponentValidationReport {
  const report = runDeclarativeValidators([
    { kind: "ajv-schema", schema: getConsistencyCaseSchema(), message: "Invalid semantic:consistency-case props", code: "consistency-case-schema" },
  ], props as Json);
  if (!report.ok) return report;

  const value = asRecord(props);
  const record = asRecord(value.case);
  const fields = asRecord(asRecord(value.spec).fields);
  const missingRequiredField = ["question", "outcome", "rationale"]
    .some((name) => !textAt(record, textAt(fields, name)).trim());
  if (!missingRequiredField) return report;

  return {
    ...report,
    ok: false,
    errors: [...report.errors, {
      detail: "Consistency case question, outcome, and rationale are required",
      code: "consistency-case-required-fields",
    }],
  };
}
export function materializeConsistencyCaseTrial() {
  return trialNode("semantic:consistency-case", {
    variant: "detailed",
    case: { prompt: "Does the reported quantity match the recorded purchase lots?", verdict: "contradictory", reason: "The broker transaction reports 100 shares sold, but the recorded purchase lots only allocate 80 shares.", certainty: "high" },
    subjects: [{ label: "Broker transaction", detail: "Reports 100 shares sold on 2026-08-04" }, { label: "Recorded purchase lots", detail: "Allocate 80 shares across lot:2025-004 and lot:2025-011" }],
    evidence: ["ledger:trade-2026-013", "lot:2025-004", "lot:2025-011"],
    spec: { title: "Consistency check", fields: { question: "prompt", outcome: "verdict", rationale: "reason", confidence: "certainty" }, subjectFields: { label: "label", detail: "detail" }, toneMap: { contradictory: "contradictory", consistent: "consistent" } },
  });
}
export const consistencyCaseDefinition = defineComponent({ description, version: "1.0.0", component: ConsistencyCase, getSchema: getConsistencyCaseSchema, validate: validateConsistencyCase, materializeTrial: materializeConsistencyCaseTrial });
