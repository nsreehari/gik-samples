import React from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import type { Json } from "gik-kernel";
import { runDeclarativeValidators } from "gik-evaluators";
import { readProps, type ProjectionView } from "gik-react";

import { componentRootProps, componentStylePropsSchema } from "../../shared/component";
import { defineComponent, trialNode, type ComponentDescription, type ComponentValidationReport } from "../../shared/definition";
import { GovernedContent } from "../content";

const useStyles = makeStyles({
  wrap: { maxWidth: "100%", overflowX: "auto", margin: `${tokens.spacingVerticalS} 0` },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: tokens.fontSizeBase200,
    "& th": { padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`, borderBottom: `${tokens.strokeWidthThick} solid ${tokens.colorNeutralStroke1}`, textAlign: "left", whiteSpace: "nowrap" },
    "& td": { padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`, borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`, textAlign: "left", verticalAlign: "top" },
    "& tbody tr:hover": { backgroundColor: tokens.colorNeutralBackground2 },
  },
});

export const Table: ProjectionView = ({ node }) => {
  const styles = useStyles();
  const props = readProps(node);
  const headers = Array.isArray(node.props.headers) ? node.props.headers.map(String) : [];
  const rows = Array.isArray(node.props.rows)
    ? node.props.rows.map((row) => Array.isArray(row) ? row.map(String) : [])
    : [];
  return (
    <div {...componentRootProps(node, styles.wrap)}>
      <table className={styles.table} aria-label={props.str("ariaLabel", "Data table")}>
        {headers.length > 0 && <thead><tr>{headers.map((header, index) => <th key={index} scope="col"><GovernedContent value={header} variant="plain-text" /></th>)}</tr></thead>}
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><GovernedContent value={cell} variant="restricted-markdown-inline" /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
};

const stringArray = { type: "array", items: { type: "string" } } as const;
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    ...componentStylePropsSchema,
    headers: stringArray,
    rows: { type: "array", items: stringArray },
    ariaLabel: { type: "string" },
  },
} as const;
const description: ComponentDescription = {
  capability: "primitive:table",
  summary: "Presents positional rows with plain-text headers and governed inline-Markdown cells.",
  dataProp: "rows",
  events: [],
  semanticTokens: [],
  variants: [],
  authoring: {
    useWhen: ["Values need comparison across stable columns"],
    avoidWhen: ["Rows require editing; use primitive:editable-table", "Content is better expressed as prose or a list"],
    rules: ["Headers are plain text", "Cells allow emphasis, inline code, and safe links", "Keep every row aligned with the header order"],
  },
};
export function validateTable(props: unknown): ComponentValidationReport {
  return runDeclarativeValidators([{ kind: "ajv-schema", schema, message: "Invalid primitive:table props", code: "primitive-table-schema" }], props as Json);
}
export const tableDefinition = defineComponent({
  description,
  version: "1.0.0",
  component: Table,
  getSchema: () => schema as unknown as Record<string, unknown>,
  validate: validateTable,
  materializeTrial: () => trialNode("primitive:table", { headers: ["Finding", "Result"], rows: [["**SQL injection**", "`Exploitable`"]], ariaLabel: "Validation results" }),
});