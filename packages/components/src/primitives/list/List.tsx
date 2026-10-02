import React from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import type { Json } from "gik-kernel";
import { runDeclarativeValidators } from "gik-evaluators";
import { readProps, type ProjectionView } from "gik-react";

import { componentRootProps, componentStylePropsSchema } from "../../shared/component";
import { defineComponent, trialNode, type ComponentDescription, type ComponentValidationReport } from "../../shared/definition";
import { GovernedContent } from "../content";

const useStyles = makeStyles({
  root: { margin: `${tokens.spacingVerticalS} 0`, paddingLeft: tokens.spacingHorizontalXXL },
});

export const List: ProjectionView = ({ node }) => {
  const styles = useStyles();
  const props = readProps(node);
  const items = Array.isArray(node.props.items) ? node.props.items.map(String) : [];
  const Tag = props.bool("ordered") ? "ol" : "ul";
  return (
    <Tag {...componentRootProps(node, styles.root)}>
      {items.map((item, index) => <li key={index}><GovernedContent value={item} variant="restricted-markdown-inline" /></li>)}
    </Tag>
  );
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    ...componentStylePropsSchema,
    items: { type: "array", items: { type: "string" } },
    ordered: { type: "boolean" },
  },
} as const;
const description: ComponentDescription = {
  capability: "primitive:list",
  summary: "Presents ordered or unordered items with governed inline Markdown.",
  dataProp: "items",
  events: [],
  semanticTokens: [],
  variants: [],
  authoring: {
    useWhen: ["Peer items or ordered steps should be scanned as a list"],
    avoidWhen: ["Items need independent actions or workflow state", "Content is tabular"],
    rules: ["Supply strings through items", "Items allow emphasis, inline code, and safe links but not block Markdown"],
  },
};
export function validateList(props: unknown): ComponentValidationReport {
  return runDeclarativeValidators([{ kind: "ajv-schema", schema, message: "Invalid primitive:list props", code: "primitive-list-schema" }], props as Json);
}
export const listDefinition = defineComponent({
  description,
  version: "1.0.0",
  component: List,
  getSchema: () => schema as unknown as Record<string, unknown>,
  validate: validateList,
  materializeTrial: () => trialNode("primitive:list", { ordered: true, items: ["Confirm the **finding**.", "Add a `regression` test."] }),
});