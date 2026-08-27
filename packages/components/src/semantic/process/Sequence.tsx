import React from "react";
import { Badge, Card, CardHeader, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
  CheckmarkCircleRegular,
  CircleRegular,
  ClipboardEditRegular,
  ClockRegular,
  SparkleRegular,
  StepsRegular,
} from "@fluentui/react-icons";
import type { Json } from "@gik-ai/kernel";
import { runDeclarativeValidators } from "@gik-ai/evaluators";
import type { ProjectionView } from "@gik-ai/react";

import type { ComponentValidationReport } from "../../shared/definition";
import { componentRootProps, componentStylePropsSchema, records, textAt, type BadgeColor } from "../../shared/component";

export const SEQUENCE_SEMANTIC_TOKENS = ["complete", "current", "upcoming", "blocked", "skipped", "unknown"] as const;
export const SEQUENCE_VARIANTS = ["standard", "compact", "progress"] as const;
export const SEQUENCE_ITEM_ICONS = ["step", "event", "wait", "observe"] as const;
type SequenceToken = typeof SEQUENCE_SEMANTIC_TOKENS[number];
type SequenceVariant = typeof SEQUENCE_VARIANTS[number];
type SequenceItemIcon = typeof SEQUENCE_ITEM_ICONS[number];

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
            icon: { type: "string", minLength: 1 },
          },
        },
        toneMap: { type: "object", additionalProperties: { enum: SEQUENCE_SEMANTIC_TOKENS } },
      },
    },
  },
} as const;

type SequenceSpec = {
  title?: string; description?: string; emptyText?: string; orientation?: "horizontal" | "vertical";
  fields: { id: string; title: string; detail?: string; order?: string; status?: string; reference?: string; icon?: string };
  toneMap?: Record<string, SequenceToken>;
};

const useStyles = makeStyles({
  root: { display: "grid", gap: tokens.spacingVerticalM },
  compactRoot: { gap: tokens.spacingVerticalS },
  heading: { display: "grid", gap: tokens.spacingVerticalXXS },
  titleRow: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  itemTitle: { display: "inline-flex", gap: tokens.spacingHorizontalXS, alignItems: "center", minWidth: 0 },
  itemIcon: { display: "inline-flex", flex: "0 0 auto" },
  progressItemTitle: {
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
  },
  progressItemIcon: {
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    "& svg": {
      width: "1em",
      height: "1em",
    },
  },
  detail: { color: tokens.colorNeutralForeground3 },
  flowList: {
    display: "flex",
    alignItems: "stretch",
    gap: tokens.spacingHorizontalXL,
    margin: 0,
    padding: 0,
    overflowX: "auto",
    listStyle: "none",
  },
  flowListVertical: {
    flexDirection: "column",
    overflowX: "visible",
    gap: tokens.spacingVerticalL,
  },
  flowStep: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: tokens.spacingHorizontalS,
    flex: "1 0 12rem",
    minWidth: 0,
    padding: tokens.spacingVerticalM,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    "&:not(:last-child)::after": {
      content: '""',
      position: "absolute",
      top: "50%",
      right: `calc(-1 * ${tokens.spacingHorizontalXL})`,
      width: tokens.spacingHorizontalXL,
      height: tokens.strokeWidthThin,
      backgroundColor: tokens.colorNeutralStrokeAccessible,
    },
  },
  flowStepVertical: {
    flexBasis: "auto",
    "&:not(:last-child)::after": {
      top: "100%",
      left: `calc(${tokens.spacingHorizontalM} + 5px)`,
      width: tokens.strokeWidthThin,
      height: tokens.spacingVerticalL,
    },
  },
  flowNode: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    borderRadius: tokens.borderRadiusCircular,
    boxShadow: `inset 0 0 0 ${tokens.strokeWidthThin} ${tokens.colorNeutralStrokeAccessible}`,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground1,
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
  },
  flowNodeComplete: {
    boxShadow: `inset 0 0 0 ${tokens.strokeWidthThin} ${tokens.colorPaletteGreenBorderActive}`,
    color: tokens.colorPaletteGreenForeground1,
    backgroundColor: tokens.colorPaletteGreenBackground1,
  },
  flowNodeCurrent: {
    boxShadow: `inset 0 0 0 ${tokens.strokeWidthThin} ${tokens.colorBrandStroke1}`,
    color: tokens.colorNeutralForegroundOnBrand,
    backgroundColor: tokens.colorBrandBackground,
  },
  flowNodeBlocked: {
    boxShadow: `inset 0 0 0 ${tokens.strokeWidthThin} ${tokens.colorPaletteRedBorderActive}`,
    color: tokens.colorPaletteRedForeground1,
    backgroundColor: tokens.colorPaletteRedBackground1,
  },
  flowCopy: { display: "grid", alignContent: "start", gap: tokens.spacingVerticalXS, minWidth: 0 },
  stagesRoot: { display: "grid", gap: tokens.spacingVerticalM, minWidth: 0 },
  stagesList: {
    display: "grid",
    gridAutoFlow: "column",
    gridAutoColumns: "minmax(9rem, 1fr)",
    gap: tokens.spacingHorizontalXS,
    margin: 0,
    padding: 0,
    overflowX: "auto",
    listStyle: "none",
  },
  stagesListVertical: {
    gridAutoFlow: "row",
    gridAutoRows: "auto",
    gridAutoColumns: "unset",
  },
  stage: {
    display: "grid",
    gap: tokens.spacingVerticalXXS,
    minWidth: 0,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderTop: `4px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  stageComplete: { borderTopColor: tokens.colorPaletteGreenBorderActive },
  stageCurrent: {
    borderTopColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorBrandBackground2,
  },
  stageBlocked: { borderTopColor: tokens.colorPaletteRedBorderActive },
  stageTitle: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: tokens.spacingHorizontalS },
  stagePosition: { color: tokens.colorNeutralForeground3, fontVariantNumeric: "tabular-nums" },
  progressRoot: { display: "grid", gap: tokens.spacingVerticalS, minWidth: 0 },
  progressList: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
    margin: 0,
    padding: 0,
    listStyle: "none",
    minWidth: 0,
  },
  progressListWithIcon: {
    paddingLeft: `calc(${tokens.fontSizeBase400} + ${tokens.spacingHorizontalXS})`,
  },
  progressStep: { flex: "0 0 1rem", width: "1rem", maxWidth: "1rem", minWidth: "1rem" },
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

export function sequenceItemIcon(icon: string): React.ReactElement | null {
  if (icon === "not-started") return <CircleRegular />;
  if (icon === "completed") return <CheckmarkCircleRegular />;
  if (icon === "step") return <StepsRegular />;
  if (icon === "event") return <SparkleRegular />;
  if (icon === "wait") return <ClockRegular />;
  if (icon === "observe") return <ClipboardEditRegular />;
  return null;
}

export const Sequence: ProjectionView = ({ node }) => {
  const styles = useStyles();
  const items = records(node.props.items);
  const spec = (node.props.spec ?? {}) as SequenceSpec;
  const variant = (node.props.variant ?? "standard") as SequenceVariant;
  if (!spec.fields || items.length === 0) return <Text {...componentRootProps(node)}>{spec.emptyText ?? "No sequence data."}</Text>;
  const ordered = spec.fields.order ? [...items].sort((left, right) => Number(textAt(left, spec.fields.order)) - Number(textAt(right, spec.fields.order))) : items;
  if (variant === "progress") {
    const itemTokens = ordered.map((item) => {
      const status = textAt(item, spec.fields.status);
      return spec.toneMap?.[status] ?? "unknown";
    });
    const notStarted = itemTokens.length > 0 && itemTokens.every((token) => token === "upcoming");
    const completed = itemTokens.length > 0 && itemTokens.every((token) => token === "complete");
    const progressItem = ordered.find((item) => {
      const status = textAt(item, spec.fields.status);
      return (spec.toneMap?.[status] ?? "unknown") === "current";
    }) ?? [...ordered].reverse().find((item) => {
      const status = textAt(item, spec.fields.status);
      return (spec.toneMap?.[status] ?? "unknown") === "complete";
    }) ?? ordered[0];
    const showProcessSummary = Boolean(spec.title) && (notStarted || completed);
    const progressTitle = showProcessSummary
      ? spec.title
      : textAt(progressItem, spec.fields.title) || spec.title;
    const progressIcon = showProcessSummary
      ? sequenceItemIcon(completed ? "completed" : "not-started")
      : spec.fields.icon
        ? sequenceItemIcon(textAt(progressItem, spec.fields.icon))
        : null;
    const progressIconLabel = showProcessSummary ? (completed ? "Completed" : "Not started") : undefined;
    return <div {...componentRootProps(node, styles.progressRoot)}>
      {progressTitle ? <span className={mergeClasses(styles.itemTitle, styles.progressItemTitle)}>{progressIcon ? <span className={mergeClasses(styles.itemIcon, styles.progressItemIcon)} aria-label={progressIconLabel} title={progressIconLabel}>{progressIcon}</span> : null}<Text size={400} weight="semibold">{progressTitle}</Text></span> : null}
      <ol
        className={mergeClasses(
          styles.progressList,
          progressIcon ? styles.progressListWithIcon : undefined,
        )}
        aria-label={spec.title ?? "Process progress"}
      >
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
  const heading = spec.title || spec.description
    ? <div className={styles.heading}>{spec.title ? <Text weight="semibold" size={500}>{spec.title}</Text> : null}{spec.description ? <Text>{spec.description}</Text> : null}</div>
    : null;
  if (variant === "compact") {
    return <section {...componentRootProps(node, styles.stagesRoot)}>
      {heading}
      <ol className={mergeClasses(styles.stagesList, spec.orientation === "vertical" && styles.stagesListVertical)}>
        {ordered.map((item, index) => {
          const status = textAt(item, spec.fields.status);
          const token = spec.toneMap?.[status] ?? "unknown";
          const icon = spec.fields.icon ? sequenceItemIcon(textAt(item, spec.fields.icon)) : null;
          return <li
            key={textAt(item, spec.fields.id) || index}
            className={mergeClasses(
              styles.stage,
              token === "complete" && styles.stageComplete,
              token === "current" && styles.stageCurrent,
              token === "blocked" && styles.stageBlocked,
            )}
            aria-current={token === "current" ? "step" : undefined}
          >
            <div className={styles.stageTitle}>
              <Text weight="semibold">{textAt(item, spec.fields.title)}</Text>
              <Text className={styles.stagePosition} size={200}>{index + 1}</Text>
            </div>
            <div className={styles.titleRow}>
              {token ? <Badge appearance="tint" color={tokenColor(token)}>{status}</Badge> : null}
              {icon ? <span className={styles.itemIcon} title={textAt(item, spec.fields.icon)}>{icon}</span> : null}
            </div>
          </li>;
        })}
      </ol>
    </section>;
  }
  return <Card {...componentRootProps(node, styles.root)} appearance="outline">
    {heading ? <CardHeader header={heading} /> : null}
    <ol className={mergeClasses(styles.flowList, spec.orientation === "vertical" && styles.flowListVertical)}>
      {ordered.map((item, index) => {
        const status = textAt(item, spec.fields.status);
        const token = spec.toneMap?.[status] ?? "unknown";
        const icon = spec.fields.icon ? sequenceItemIcon(textAt(item, spec.fields.icon)) : null;
        return <li
          key={textAt(item, spec.fields.id) || index}
          className={mergeClasses(styles.flowStep, spec.orientation === "vertical" && styles.flowStepVertical)}
          aria-current={token === "current" ? "step" : undefined}
        >
          <span className={mergeClasses(
            styles.flowNode,
            token === "complete" && styles.flowNodeComplete,
            token === "current" && styles.flowNodeCurrent,
            token === "blocked" && styles.flowNodeBlocked,
          )}>{index + 1}</span>
          <div className={styles.flowCopy}>
            <div className={styles.titleRow}>
              <span className={styles.itemTitle}>
                {icon ? <span className={styles.itemIcon}>{icon}</span> : null}
                <Text weight="semibold">{textAt(item, spec.fields.title)}</Text>
              </span>
              {token ? <Badge appearance="tint" color={tokenColor(token)}>{status}</Badge> : null}
            </div>
            {spec.fields.reference && textAt(item, spec.fields.reference) ? <Text size={200}>{textAt(item, spec.fields.reference)}</Text> : null}
            {spec.fields.detail && textAt(item, spec.fields.detail) ? <Text className={styles.detail}>{textAt(item, spec.fields.detail)}</Text> : null}
          </div>
        </li>;
      })}
    </ol>
  </Card>;
};

export function getSequenceSchema(): Record<string, unknown> { return sequencePropsSchema as unknown as Record<string, unknown>; }
export function validateSequence(props: unknown): ComponentValidationReport {
  return runDeclarativeValidators([{ kind: "ajv-schema", schema: getSequenceSchema(), message: "Invalid sequence renderer props", code: "sequence-schema" }], props as Json);
}