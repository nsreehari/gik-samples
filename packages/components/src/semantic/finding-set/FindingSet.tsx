import React from "react";
import { Badge, Card, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { Json } from "gik-kernel";
import { runDeclarativeValidators } from "gik-evaluators";
import type { ProjectionView } from "gik-react";

import { componentRootProps, componentStylePropsSchema, records, textAt, type BadgeColor, type DataRecord } from "../../shared/component";
import { defineComponent, trialNode, type ComponentDescription, type ComponentValidationReport } from "../../shared/definition";

export const FINDING_SET_SEMANTIC_TOKENS = ["critical", "high", "medium", "low", "informational"] as const;
export const FINDING_SET_VARIANTS = ["list", "compact", "text"] as const;
type FindingToken = typeof FINDING_SET_SEMANTIC_TOKENS[number];
type FindingSetVariant = typeof FINDING_SET_VARIANTS[number];

interface FindingSetSpec {
  title?: string;
  description?: string;
  emptyText?: string;
  fields: { id: string; title: string; explanation: string; severity: string; status: string; confidence?: string; affects?: string; evidence?: string };
  toneMap?: Record<string, FindingToken>;
}

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#", type: "object", additionalProperties: false, required: ["findings", "spec"],
  properties: {
    ...componentStylePropsSchema,
    findings: { type: "array", items: { type: "object" } }, variant: { enum: FINDING_SET_VARIANTS },
    spec: { type: "object", additionalProperties: false, required: ["fields"], properties: {
      title: { type: "string" }, description: { type: "string" }, emptyText: { type: "string" },
      fields: { type: "object", additionalProperties: false, required: ["id", "title", "explanation", "severity", "status"], properties: {
        id: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 }, explanation: { type: "string", minLength: 1 },
        severity: { type: "string", minLength: 1 }, status: { type: "string", minLength: 1 }, confidence: { type: "string", minLength: 1 },
        affects: { type: "string", minLength: 1 }, evidence: { type: "string", minLength: 1 },
      } },
      toneMap: { type: "object", additionalProperties: { enum: FINDING_SET_SEMANTIC_TOKENS } },
    } },
  },
} as const;

const useStyles = makeStyles({
  root: { display: "grid", gap: tokens.spacingVerticalM },
  header: { display: "grid", gap: tokens.spacingVerticalXXS },
  description: { color: tokens.colorNeutralForeground3 },
  list: { display: "grid", gap: tokens.spacingVerticalS },
  item: { display: "grid", gap: tokens.spacingVerticalXS },
  compactItem: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", alignItems: "center", gap: tokens.spacingHorizontalS },
  titleRow: { display: "flex", alignItems: "baseline", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  explanation: { color: tokens.colorNeutralForeground2 },
  meta: { color: tokens.colorNeutralForeground3 },
  refs: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS },
  text: { display: "grid", gap: tokens.spacingVerticalXS },
});

function severityColor(token: FindingToken | undefined): BadgeColor {
  if (token === "critical" || token === "high") return "danger";
  if (token === "medium") return "warning";
  return "informative";
}

function refs(finding: DataRecord, path: string | undefined): string[] {
  if (!path) return [];
  const value = path.split(".").reduce<unknown>((current, segment) => (current && typeof current === "object" && !Array.isArray(current) ? (current as DataRecord)[segment] : undefined), finding);
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

export const FindingSet: ProjectionView = ({ node }) => {
  const styles = useStyles();
  const findings = records(node.props.findings);
  const spec = (node.props.spec ?? {}) as unknown as FindingSetSpec;
  const variant = (node.props.variant ?? "list") as FindingSetVariant;
  if (!spec.fields || findings.length === 0) return <Text {...componentRootProps(node)}>{spec.emptyText ?? "No findings available."}</Text>;
  const header = spec.title || spec.description ? <header className={styles.header}>{spec.title ? <Text weight="semibold" size={500}>{spec.title}</Text> : null}{spec.description ? <Text className={styles.description}>{spec.description}</Text> : null}</header> : null;
  const root = componentRootProps(node, styles.root);

  if (variant === "text") return <section {...root}>{header}<div className={styles.text}>{findings.map((finding, index) => <Text key={textAt(finding, spec.fields.id) || index}>[{textAt(finding, spec.fields.severity)}] {textAt(finding, spec.fields.title)} ({textAt(finding, spec.fields.status)}): {textAt(finding, spec.fields.explanation)}</Text>)}</div></section>;

  if (variant === "compact") return <section {...root}>{header}<div className={styles.list}>{findings.map((finding, index) => {
    const severity = textAt(finding, spec.fields.severity); const token = spec.toneMap?.[severity];
    return <Card appearance="outline" className={styles.compactItem} key={textAt(finding, spec.fields.id) || index}>
      <Text weight="semibold">{textAt(finding, spec.fields.title)}</Text>
      <Badge appearance="tint" color={severityColor(token)}>{severity}</Badge>
      <Badge appearance="outline">{textAt(finding, spec.fields.status)}</Badge>
    </Card>;
  })}</div></section>;

  return <section {...root}>{header}<div className={styles.list}>{findings.map((finding, index) => {
    const severity = textAt(finding, spec.fields.severity); const token = spec.toneMap?.[severity];
    const confidence = spec.fields.confidence ? textAt(finding, spec.fields.confidence) : "";
    const affected = refs(finding, spec.fields.affects); const evidence = refs(finding, spec.fields.evidence);
    return <Card appearance="outline" className={styles.item} key={textAt(finding, spec.fields.id) || index}>
      <div className={styles.titleRow}>
        <Text weight="semibold" size={400}>{textAt(finding, spec.fields.title)}</Text>
        <Badge appearance="tint" color={severityColor(token)}>{severity}</Badge>
        <Badge appearance="outline">{textAt(finding, spec.fields.status)}</Badge>
      </div>
      <Text className={styles.explanation}>{textAt(finding, spec.fields.explanation)}</Text>
      {confidence ? <Text className={styles.meta} size={200}>Confidence: {confidence}</Text> : null}
      {affected.length > 0 ? <div className={styles.refs} aria-label="Affected items">{affected.map((ref) => <Badge key={ref} appearance="ghost" shape="rounded">{ref}</Badge>)}</div> : null}
      {evidence.length > 0 ? <div className={styles.refs} aria-label="Supporting evidence">{evidence.map((ref) => <Badge key={ref} appearance="ghost" shape="rounded" color="informative">{ref}</Badge>)}</div> : null}
    </Card>;
  })}</div></section>;
};

const description: ComponentDescription = {
  capability: "semantic:finding-set", summary: "Presents data-quality or reconciliation findings as scannable cards, compact rows, or text.", dataProp: "findings", events: [], semanticTokens: FINDING_SET_SEMANTIC_TOKENS, defaultVariant: "list",
  variants: [
    { value: "list", summary: "Detailed findings with explanation, affected items, and evidence.", useWhen: ["Findings need full supporting detail for review"] },
    { value: "compact", summary: "Dense scanning rows of title, severity, and status.", useWhen: ["Many findings must be scanned quickly"] },
    { value: "text", summary: "Complete linear text projection.", useWhen: ["Visual layout is unavailable or inappropriate"] },
  ],
  authoring: { useWhen: ["Records are individual data-quality, reconciliation, or review findings"], avoidWhen: ["A single overall judgment is the subject; use assessment", "Two records are being compared for agreement; use consistency-case"], rules: ["Map identity, title, explanation, severity, and status fields", "Preserve affected-item and evidence references as authored strings", "Never infer severity or status from explanation text"] },
};

export function getFindingSetSchema(): Record<string, unknown> { return schema as unknown as Record<string, unknown>; }
export function validateFindingSet(props: unknown): ComponentValidationReport {
  return runDeclarativeValidators([
    { kind: "ajv-schema", schema: getFindingSetSchema(), message: "Invalid semantic:finding-set props", code: "finding-set-schema" },
    { kind: "jsonata", expr: "($field := data.spec.fields.id; $ids := data.findings.$lookup($, $field); $count($ids) = $count($distinct($ids)))", message: "Finding IDs must be unique", code: "finding-set-unique-id" },
  ], props as Json);
}
export function materializeFindingSetTrial() {
  return trialNode("semantic:finding-set", {
    variant: "list",
    findings: [
      { key: "lot-alloc-mismatch", title: "Allocated quantity does not equal sold quantity", detail: "The sale references purchase lots whose allocated quantity totals 80 shares, but 100 shares were sold.", level: "high", state: "open", certainty: "high", related: ["sale:2026-013", "lot:2025-004", "lot:2025-011"], sources: ["ledger:trade-2026-013"] },
      { key: "missing-cost-basis", title: "Missing cost basis for a purchase lot", detail: "Purchase lot lot:2025-011 has no recorded cost basis.", level: "medium", state: "investigating", certainty: "medium", related: ["lot:2025-011"], sources: [] },
    ],
    spec: { title: "Data-quality findings", description: "Findings from the reconciliation pass", fields: { id: "key", title: "title", explanation: "detail", severity: "level", status: "state", confidence: "certainty", affects: "related", evidence: "sources" }, toneMap: { high: "high", medium: "medium" } },
  });
}
export const findingSetDefinition = defineComponent({ description, version: "1.0.0", component: FindingSet, getSchema: getFindingSetSchema, validate: validateFindingSet, materializeTrial: materializeFindingSetTrial });
