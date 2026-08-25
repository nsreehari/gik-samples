import React from "react";
import { Badge, Card, CardHeader, Divider, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { Json } from "@gik/kernel";
import { runDeclarativeValidators } from "@gik/evaluators";
import type { ProjectionView } from "@gik/react";

import type { ComponentValidationReport } from "../../shared/definition";
import { componentRootProps, componentStylePropsSchema, records, textAt, type BadgeColor } from "../../shared/component";

export const SEQUENCE_SEMANTIC_TOKENS = ["complete", "current", "upcoming", "blocked", "skipped", "unknown"] as const;
export const SEQUENCE_VARIANTS = ["standard", "compact", "progress"] as const;
type SequenceToken = typeof SEQUENCE_SEMANTIC_TOKENS[number];
type SequenceVariant = typeof SEQUENCE_VARIANTS[number];

const sequencePropsSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: ["items", "spec"],
  properties: {
    ...componentStylePropsSchema,
    items: { type: "array", items: { type: "object" } },
    variant: { enum: SEQUENCE_VARIANTS },
    spec: {
      type: "object",
      additionalProperties: false,
      required: ["fields"],
      properties: {
        title: { type: "string" }, description: { type: "string" }, emptyText: { type: "string" },
        orientation: { enum: ["horizontal", "vertical"] },
        fields: {
          type: "object", additionalProperties: false, required: ["id", "title"],
          properties: {
            id: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 },
            detail: { type: "string", minLength: 1 }, order: { type: "string", minLength: 1 },
            status: { type: "string", minLength: 1 }, reference: { type: "string", minLength: 1 },
          },
        },
        toneMap: { type: "object", additionalProperties: { enum: SEQUENCE_SEMANTIC_TOKENS } },
      },
    },
  },
} as const;

type SequenceSpec = {
  title?: string; description?: string; emptyText?: string; orientation?: "horizontal" | "vertical";
  fields: { id: string; title: string; detail?: string; order?: string; status?: string; reference?: string };
  toneMap?: Record<string, SequenceToken>;
};

const useStyles = makeStyles({
  root: { display: "grid", gap: tokens.spacingVerticalM },
  compactRoot: { gap: tokens.spacingVerticalS },
  heading: { display: "grid", gap: tokens.spacingVerticalXXS },
  list: { display: "flex", gap: tokens.spacingHorizontalM, margin: 0, padding: 0, listStyle: "none", flexWrap: "wrap" },
  compactList: { gap: tokens.spacingHorizontalS },
  vertical: { flexDirection: "column" },
  step: { display: "grid", gap: tokens.spacingVerticalXS, flex: "1 1 12rem", minWidth: 0 },
  compactStep: { gap: tokens.spacingVerticalXXS, flexBasis: "9rem" },
  titleRow: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  detail: { color: tokens.colorNeutralForeground3 },
  progressRoot: { display: "grid", gap: tokens.spacingVerticalS, minWidth: 0 },
  progressList: { display: "flex", gap: tokens.spacingHorizontalXS, margin: 0, padding: 0, listStyle: "none" },
  progressStep: { flex: "1 1 0", minWidth: tokens.spacingHorizontalS },
  progressMarker: {
    display: "block",
    height: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground5,
  },
  progressMarkerComplete: { backgroundColor: tokens.colorBrandBackground },
  progressMarkerCurrent: {
    backgroundColor: tokens.colorBrandBackground2,
    boxShadow: `inset 0 0 0 1px ${tokens.colorBrandStroke1}`,
  },
  progressMarkerBlocked: { backgroundColor: tokens.colorPaletteRedBackground3 },
  visuallyHidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  },
});

function tokenColor(token: SequenceToken): BadgeColor {
  if (token === "complete") return "success";
  if (token === "current") return "brand";
  if (token === "upcoming") return "informative";
  if (token === "blocked") return "danger";
  if (token === "skipped") return "subtle";
  return "informative";
}

export const Sequence: ProjectionView = ({ node }) => {
  const styles = useStyles();
  const items = records(node.props.items);
  const spec = (node.props.spec ?? {}) as SequenceSpec;
  const variant = (node.props.variant ?? "standard") as SequenceVariant;
  if (!spec.fields || items.length === 0) return <Text {...componentRootProps(node)}>{spec.emptyText ?? "No sequence data."}</Text>;
  const ordered = spec.fields.order ? [...items].sort((left, right) => Number(textAt(left, spec.fields.order)) - Number(textAt(right, spec.fields.order))) : items;
  if (variant === "progress") {
    return <div {...componentRootProps(node, styles.progressRoot)}>
      {spec.title || spec.description ? <div className={styles.heading}>{spec.title ? <Text weight="semibold">{spec.title}</Text> : null}{spec.description ? <Text>{spec.description}</Text> : null}</div> : null}
      <ol className={styles.progressList} aria-label={spec.title ?? "Process progress"}>
        {ordered.map((item, index) => {
          const status = textAt(item, spec.fields.status);
          const token = spec.toneMap?.[status] ?? "unknown";
          return <li
            key={textAt(item, spec.fields.id) || index}
            className={styles.progressStep}
            aria-current={token === "current" ? "step" : undefined}
            title={`${textAt(item, spec.fields.title)}${status ? `: ${status}` : ""}`}
          >
            <span className={mergeClasses(
              styles.progressMarker,
              token === "complete" && styles.progressMarkerComplete,
              token === "current" && styles.progressMarkerCurrent,
              token === "blocked" && styles.progressMarkerBlocked,
            )} />
            <span className={styles.visuallyHidden}>
              {textAt(item, spec.fields.title)}{status ? `: ${status}` : ""}
            </span>
          </li>;
        })}
      </ol>
    </div>;
  }
  return <Card {...componentRootProps(node, mergeClasses(styles.root, variant === "compact" && styles.compactRoot))} appearance="outline">
    {spec.title || spec.description ? <CardHeader header={<div className={styles.heading}>{spec.title ? <Text weight="semibold" size={500}>{spec.title}</Text> : null}{spec.description ? <Text>{spec.description}</Text> : null}</div>} /> : null}
    <ol className={mergeClasses(styles.list, variant === "compact" && styles.compactList, spec.orientation === "vertical" && styles.vertical)}>
      {ordered.map((item, index) => {
        const status = textAt(item, spec.fields.status);
        const token = spec.toneMap?.[status];
        return <React.Fragment key={textAt(item, spec.fields.id) || index}>
          {index > 0 ? <Divider vertical={spec.orientation !== "vertical"} /> : null}
          <li className={mergeClasses(styles.step, variant === "compact" && styles.compactStep)}>
            <div className={styles.titleRow}><Text weight="semibold">{textAt(item, spec.fields.title)}</Text>{token ? <Badge appearance="tint" color={tokenColor(token)}>{status}</Badge> : null}</div>
            {spec.fields.reference && textAt(item, spec.fields.reference) ? <Text size={200}>{textAt(item, spec.fields.reference)}</Text> : null}
            {spec.fields.detail && textAt(item, spec.fields.detail) ? <Text className={styles.detail}>{textAt(item, spec.fields.detail)}</Text> : null}
          </li>
        </React.Fragment>;
      })}
    </ol>
  </Card>;
};

export function getSequenceSchema(): Record<string, unknown> { return sequencePropsSchema as unknown as Record<string, unknown>; }
export function validateSequence(props: unknown): ComponentValidationReport {
  return runDeclarativeValidators([{ kind: "ajv-schema", schema: getSequenceSchema(), message: "Invalid sequence renderer props", code: "sequence-schema" }], props as Json);
}