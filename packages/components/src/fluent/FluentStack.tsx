import React from "react";
import { readProps, type ProjectionView } from "gik-react";

import { componentRootProps, withComponentStylePropsSchema } from "../shared/component";
import { type ComponentDescription } from "../shared/definition";
import { defineFluentComponent } from "./defineFluentComponent";

const alignments = ["start", "end", "center", "space-between", "space-around", "space-evenly", "baseline", "stretch"] as const;
const itemAlignments = ["auto", "stretch", "baseline", "start", "center", "end"] as const;
const growthValues = [{ type: "boolean" }, { type: "number" }, { type: "string", enum: ["inherit", "initial", "unset"] }] as const;
const sizeValue = { type: ["number", "string"] } as const;

function cssAlignment(value: string | undefined): React.CSSProperties["alignItems"] {
  if (value === "start") return "flex-start";
  if (value === "end") return "flex-end";
  return value as React.CSSProperties["alignItems"];
}

function cssGrowth(value: unknown): React.CSSProperties["flexGrow"] {
  if (value === true) return 1;
  if (value === false || value === undefined) return undefined;
  return value as React.CSSProperties["flexGrow"];
}

export const FluentStack: ProjectionView = ({ node, children }) => {
  const props = readProps(node);
  const horizontal = props.bool("horizontal", false);
  const reversed = props.bool("reversed", false);
  const horizontalAlign = cssAlignment(props.str("horizontalAlign"));
  const verticalAlign = cssAlignment(props.str("verticalAlign"));
  const tokenProps = node.props.tokens && typeof node.props.tokens === "object" && !Array.isArray(node.props.tokens)
    ? node.props.tokens as Record<string, unknown>
    : {};
  const rootProps = componentRootProps(node);
  const layoutStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: horizontal
      ? reversed ? "row-reverse" : "row"
      : reversed ? "column-reverse" : "column",
    justifyContent: horizontal ? horizontalAlign : verticalAlign,
    alignItems: horizontal ? verticalAlign : horizontalAlign,
    flexWrap: props.bool("wrap", false) ? "wrap" : undefined,
    flexGrow: cssGrowth(node.props.grow),
    height: props.bool("verticalFill", false) ? "100%" : undefined,
    flexShrink: props.bool("disableShrink", false) ? 0 : undefined,
    gap: tokenProps.childrenGap as React.CSSProperties["gap"],
    maxHeight: tokenProps.maxHeight as React.CSSProperties["maxHeight"],
    maxWidth: tokenProps.maxWidth as React.CSSProperties["maxWidth"],
    padding: tokenProps.padding as React.CSSProperties["padding"],
  };
  return <div {...rootProps} style={{ ...layoutStyle, ...rootProps.style }}>{children}</div>;
};

export const FluentStackItem: ProjectionView = ({ node, children }) => {
  if (React.Children.count(children) !== 1) {
    throw new Error("fluent:stack-item requires exactly one child");
  }
  const props = readProps(node);
  const tokenProps = node.props.tokens && typeof node.props.tokens === "object" && !Array.isArray(node.props.tokens)
    ? node.props.tokens as Record<string, unknown>
    : {};
  const rootProps = componentRootProps(node);
  const layoutStyle: React.CSSProperties = {
    flexGrow: cssGrowth(node.props.grow),
    flexShrink: props.bool("disableShrink", false) ? 0 : cssGrowth(node.props.shrink),
    alignSelf: cssAlignment(props.str("align")) as React.CSSProperties["alignSelf"],
    height: props.bool("verticalFill", false) ? "100%" : undefined,
    flexBasis: node.props.basis as React.CSSProperties["flexBasis"],
    order: node.props.order as React.CSSProperties["order"],
    margin: tokenProps.margin as React.CSSProperties["margin"],
    padding: tokenProps.padding as React.CSSProperties["padding"],
  };
  return <div {...rootProps} style={{ ...layoutStyle, ...rootProps.style }}>{children}</div>;
};

const stackSchema = withComponentStylePropsSchema({
  type: "object",
  additionalProperties: false,
  properties: {
    horizontal: { type: "boolean" },
    reversed: { type: "boolean" },
    horizontalAlign: { type: "string", enum: alignments },
    verticalAlign: { type: "string", enum: alignments },
    verticalFill: { type: "boolean" },
    disableShrink: { type: "boolean" },
    grow: { anyOf: growthValues },
    wrap: { type: "boolean" },
    tokens: {
      type: "object",
      additionalProperties: false,
      properties: {
        childrenGap: sizeValue,
        maxHeight: sizeValue,
        maxWidth: sizeValue,
        padding: sizeValue,
      },
    },
  },
} as const);

const stackItemSchema = withComponentStylePropsSchema({
  type: "object",
  additionalProperties: false,
  properties: {
    grow: { anyOf: growthValues },
    shrink: { anyOf: growthValues },
    disableShrink: { type: "boolean" },
    align: { type: "string", enum: itemAlignments },
    verticalFill: { type: "boolean" },
    basis: sizeValue,
    order: sizeValue,
    tokens: {
      type: "object",
      additionalProperties: false,
      properties: {
        margin: sizeValue,
        padding: sizeValue,
      },
    },
  },
} as const);

const stackDescription: ComponentDescription = {
  capability: "fluent:stack",
  summary: "Arranges authored children using Fluent Stack layout semantics.",
  slots: ["children"],
  events: [],
  semanticTokens: [],
  variants: [],
  authoring: {
    useWhen: ["Authored children need governed horizontal or vertical flex layout"],
    avoidWhen: ["Content should follow ordinary document flow"],
    rules: ["Use tokens for spacing and sizing", "Wrap children only when overflow is expected"],
  },
};

const stackItemDescription: ComponentDescription = {
  capability: "fluent:stack-item",
  summary: "Controls one authored child's sizing and alignment within a Fluent Stack.",
  slots: ["children"],
  events: [],
  semanticTokens: [],
  variants: [],
  authoring: {
    useWhen: ["One Stack child needs explicit growth, shrink, order, or alignment behavior"],
    avoidWhen: ["The child uses the parent Stack defaults"],
    rules: ["Provide exactly one child", "Use only as a direct child of fluent:stack"],
  },
};

export const fluentStackDefinition = defineFluentComponent(stackDescription, stackSchema, FluentStack, {
  tokens: { childrenGap: 12 },
});
export const fluentStackItemDefinition = defineFluentComponent(stackItemDescription, stackItemSchema, FluentStackItem, {});