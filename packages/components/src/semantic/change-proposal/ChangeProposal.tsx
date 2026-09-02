import React from "react";
import { Badge, Button, Card, Divider, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { Json } from "@gik-ai/kernel";
import { runDeclarativeValidators } from "@gik-ai/evaluators";
import type { ProjectionView } from "@gik-ai/react";

import { asRecord, componentRootProps, componentStylePropsSchema, records, textAt, type BadgeColor } from "../../shared/component";
import { defineComponent, eventContract, trialNode, type ComponentDescription, type ComponentValidationReport } from "../../shared/definition";

export const CHANGE_PROPOSAL_SEMANTIC_TOKENS = ["pending", "approved", "rejected", "changes-requested"] as const;
export const CHANGE_PROPOSAL_VARIANTS = ["review", "compact"] as const;
type ChangeProposalToken = typeof CHANGE_PROPOSAL_SEMANTIC_TOKENS[number];
type ChangeProposalVariant = typeof CHANGE_PROPOSAL_VARIANTS[number];

interface ChangeProposalSpec {
  emptyText?: string;
  fields: { id: string; title: string; status: string; rationale: string; impact?: string; target?: string };
  changeFields?: { field: string; before: string; after: string };
  toneMap?: Record<string, ChangeProposalToken>;
}

const schema = {
  $schema: "http://json-schema.org/draft-07/schema#", type: "object", additionalProperties: false, required: ["proposal", "spec"],
  properties: {
    ...componentStylePropsSchema,
    proposal: { type: "object" }, changes: { type: "array", items: { type: "object" } }, references: { type: "array", items: { type: "string" } },
    variant: { enum: CHANGE_PROPOSAL_VARIANTS },
    spec: { type: "object", additionalProperties: false, required: ["fields"], properties: {
      emptyText: { type: "string" },
      fields: { type: "object", additionalProperties: false, required: ["id", "title", "status", "rationale"], properties: {
        id: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 }, status: { type: "string", minLength: 1 }, rationale: { type: "string", minLength: 1 }, impact: { type: "string", minLength: 1 }, target: { type: "string", minLength: 1 },
      } },
      changeFields: { type: "object", additionalProperties: false, required: ["field", "before", "after"], properties: { field: { type: "string", minLength: 1 }, before: { type: "string", minLength: 1 }, after: { type: "string", minLength: 1 } } },
      toneMap: { type: "object", additionalProperties: { enum: CHANGE_PROPOSAL_SEMANTIC_TOKENS } },
    } },
  },
} as const;

const useStyles = makeStyles({
  root: { display: "grid", gap: tokens.spacingVerticalM },
  rationale: { color: tokens.colorNeutralForeground2 },
  meta: { color: tokens.colorNeutralForeground3 },
  changes: { display: "grid", gap: tokens.spacingVerticalXS },
  change: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: tokens.spacingHorizontalS },
  before: { color: tokens.colorPaletteRedForeground2, textDecorationLine: "line-through" },
  after: { color: tokens.colorPaletteGreenForeground2 },
  refs: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS },
  actions: { display: "flex", gap: tokens.spacingHorizontalS },
});

function tone(token: ChangeProposalToken | undefined): BadgeColor {
  if (token === "approved") return "success";
  if (token === "rejected") return "danger";
  if (token === "changes-requested") return "warning";
  return "informative";
}

export const ChangeProposal: ProjectionView = ({ node, emit }) => {
  const styles = useStyles();
  const record = asRecord(node.props.proposal);
  const spec = (node.props.spec ?? {}) as unknown as ChangeProposalSpec;
  const variant = (node.props.variant ?? "review") as ChangeProposalVariant;
  if (!spec.fields || Object.keys(record).length === 0) return <Text {...componentRootProps(node)}>{spec.emptyText ?? "No change proposal available."}</Text>;
  const status = textAt(record, spec.fields.status);
  const token = spec.toneMap?.[status];
  const id = textAt(record, spec.fields.id);
  const changes = records(node.props.changes);
  const references = Array.isArray(node.props.references) ? node.props.references.map(String) : [];
  const root = componentRootProps(node, styles.root);
  return <Card {...root} appearance="outline">
    <Text weight="semibold" size={500}>{textAt(record, spec.fields.title)}</Text>
    <div><Badge appearance="filled" color={tone(token)}>{status}</Badge></div>
    {spec.fields.target && textAt(record, spec.fields.target) ? <Text className={styles.meta} size={200}>Target: {textAt(record, spec.fields.target)}</Text> : null}
    {variant === "review" ? <>
      <Text className={styles.rationale}>{textAt(record, spec.fields.rationale)}</Text>
      {spec.fields.impact && textAt(record, spec.fields.impact) ? <Text size={200}>Impact: {textAt(record, spec.fields.impact)}</Text> : null}
      {changes.length > 0 && spec.changeFields ? <><Divider /><div className={styles.changes} aria-label="Proposed changes">{changes.map((change, index) => <div className={styles.change} key={index}>
        <Text className={styles.before}>{textAt(change, spec.changeFields!.before)}</Text>
        <Text>{textAt(change, spec.changeFields!.field)}</Text>
        <Text className={styles.after}>{textAt(change, spec.changeFields!.after)}</Text>
      </div>)}</div></> : null}
      {references.length > 0 ? <div className={styles.refs} aria-label="Motivating findings and evidence">{references.map((ref) => <Badge key={ref} appearance="ghost" shape="rounded">{ref}</Badge>)}</div> : null}
      <div className={styles.actions}>
        <Button appearance="primary" onClick={() => void emit("approve", { id })}>Approve</Button>
        <Button onClick={() => void emit("requestChanges", { id })}>Request changes</Button>
        <Button appearance="outline" onClick={() => void emit("reject", { id })}>Reject</Button>
      </div>
    </> : null}
  </Card>;
};

const description: ComponentDescription = {
  capability: "semantic:change-proposal", summary: "Presents a proposed correction for human review before a Blueprint performs any write.", dataProp: "proposal", events: ["approve", "reject", "requestChanges"],
  eventContracts: {
    approve: eventContract("The user approves the proposed change.", { id: { type: "string" } }),
    reject: eventContract("The user rejects the proposed change.", { id: { type: "string" } }),
    requestChanges: eventContract("The user requests changes to the proposal before it can be approved.", { id: { type: "string" } }),
  },
  semanticTokens: CHANGE_PROPOSAL_SEMANTIC_TOKENS, defaultVariant: "review",
  variants: [
    { value: "review", summary: "Full rationale, before/after changes, references, and review actions.", useWhen: ["A human must review and act on the proposal"] },
    { value: "compact", summary: "Title, target, and status only.", useWhen: ["The proposal appears in a scanning list"] },
  ],
  authoring: { useWhen: ["A correction is proposed for human review before a write is performed"], avoidWhen: ["The change has already been applied; use assessment or finding-set to report the result"], rules: ["The Blueprint, not this component, performs the write when approve is emitted", "Preserve finding and evidence references as authored data", "Represent before and after values without altering them"] },
};

export function getChangeProposalSchema(): Record<string, unknown> { return schema as unknown as Record<string, unknown>; }
export function validateChangeProposal(props: unknown): ComponentValidationReport {
  return runDeclarativeValidators([{ kind: "ajv-schema", schema: getChangeProposalSchema(), message: "Invalid semantic:change-proposal props", code: "change-proposal-schema" }], props as Json);
}
export function materializeChangeProposalTrial() {
  return trialNode("semantic:change-proposal", {
    variant: "review",
    proposal: { key: "cp-2026-013", name: "Correct purchase-lot allocation for sale:2026-013", state: "pending", reason: "The current allocation understates the sold quantity by 20 shares.", consequence: "Realized gain for 2026 would increase by an estimated $412.", subject: "lot:2025-011" },
    changes: [{ attribute: "allocatedQuantity", was: "80 shares", now: "100 shares" }],
    references: ["finding:lot-alloc-mismatch", "lot:2025-004", "lot:2025-011"],
    spec: { fields: { id: "key", title: "name", status: "state", rationale: "reason", impact: "consequence", target: "subject" }, changeFields: { field: "attribute", before: "was", after: "now" }, toneMap: { pending: "pending", approved: "approved", rejected: "rejected" } },
  });
}
export const changeProposalDefinition = defineComponent({ description, version: "1.0.0", component: ChangeProposal, getSchema: getChangeProposalSchema, validate: validateChangeProposal, materializeTrial: materializeChangeProposalTrial });
