import React from "react";
import { runDeclarativeValidators } from "@gik-ai/evaluators";
import type { Json } from "@gik-ai/kernel";
import type { ProjectionView, ProjectionViewProps } from "@gik-ai/react";
import {
  GikComponent,
  defineComponent,
  trialNode,
  type ComponentDescription,
  type ComponentValidationReport,
} from "@gik-ai/components";
import { finbookExplorerPropsSchema } from "./FinbookExplorerContract";

interface ExplorerResult {
  title: string;
  description?: string;
  rows: Array<Record<string, Json>>;
}

const rootStyle: React.CSSProperties = { display: "grid", gap: "16px", minWidth: 0 };
const headingStyle: React.CSSProperties = { display: "grid", gap: "4px" };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: "20px", lineHeight: 1.4, fontWeight: 600 };
const descriptionStyle: React.CSSProperties = { margin: 0, color: "var(--colorNeutralForeground2)" };
const emptyStyle: React.CSSProperties = {
  margin: 0,
  padding: "20px",
  color: "var(--colorNeutralForeground3)",
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: "6px",
};

function readResult(value: Json | undefined): ExplorerResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { title: "Finbook report", rows: [] };
  }
  return value as unknown as ExplorerResult;
}

function tableCell(value: Json): string | number | boolean | null {
  return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
}

export function FinbookExplorer({ node }: ProjectionViewProps) {
  const result = readResult(node.props.result);
  const columnIds = [...new Set(result.rows.flatMap((row) => Object.keys(row)))];
  const columns = columnIds.map((id) => ({ id, label: id }));
  const rows = result.rows.map((row, index) => ({
    id: typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : `row-${index}`,
    cells: Object.fromEntries(columnIds.map((id) => [id, tableCell(row[id] ?? null)])),
  }));
  const className = typeof node.props.className === "string" ? node.props.className : undefined;
  const emptyMessage = typeof node.props.emptyMessage === "string"
    ? node.props.emptyMessage
    : "No records match the current selection.";

  return (
    <section className={className} style={rootStyle} aria-label={result.title}>
      <header style={headingStyle}>
        <h2 style={titleStyle}>{result.title}</h2>
        {result.description ? <p style={descriptionStyle}>{result.description}</p> : null}
      </header>
      {columns.length > 0 && rows.length > 0
        ? (
            <GikComponent
              kind="fluent:table"
              componentProps={{
                ariaLabel: result.title,
                columns,
                rows,
                size: "small",
              }}
            />
          )
        : <p style={emptyStyle}>{emptyMessage}</p>}
    </section>
  );
}

const description: ComponentDescription = {
  capability: "finance:finbook-explorer",
  summary: "Presents one Finbook query result as a titled, read-only table.",
  dataProp: "result",
  events: [],
  semanticTokens: ["financial-report", "tabular-records"],
  variants: [],
  authoring: {
    useWhen: ["A Finbook query result needs a single read-only tabular presentation"],
    avoidWhen: ["Users must edit rows", "Several independent reports must be presented together"],
    rules: [
      "Provide explicit columns and stable row ids",
      "Keep query execution and selection state in Blueprint Cells",
      "Use one result table per component instance",
    ],
  },
  agentFacing: {
    catalog: {
      for: ["Finbook report exploration"],
      notFor: ["Financial record editing", "Multi-report dashboards"],
      interaction: "read-only",
    },
  },
};

export function validateFinbookExplorer(props: unknown): ComponentValidationReport {
  return runDeclarativeValidators([{
    kind: "ajv-schema",
    schema: finbookExplorerPropsSchema,
    message: "Invalid finance:finbook-explorer props",
    code: "finance-finbook-explorer-schema",
  }], props as Json);
}

export function materializeFinbookExplorerTrial() {
  return trialNode("finance:finbook-explorer", {
    result: {
      title: "Stock transactions",
      description: "Transactions for the selected account and financial year.",
      rows: [
        { id: "transaction-1", date: "2025-04-01", security: "ACME" },
      ],
    },
  });
}

export const finbookExplorerDefinition = defineComponent({
  description,
  version: "1.0.0",
  component: FinbookExplorer,
  getSchema: () => finbookExplorerPropsSchema,
  validate: validateFinbookExplorer,
  materializeTrial: materializeFinbookExplorerTrial,
});

export const financeComponentDefinitions = {
  "finbook-explorer": finbookExplorerDefinition,
} as const;

export const financeComponentViews: Record<string, ProjectionView> = {
  "finbook-explorer": FinbookExplorer,
};
