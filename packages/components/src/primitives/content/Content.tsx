import React from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import type { Json } from "gik-kernel";
import { runDeclarativeValidators } from "gik-evaluators";
import { readProps, type ProjectionView } from "gik-react";

import { componentRootProps, componentStylePropsSchema } from "../../shared/component";
import { defineComponent, trialNode, type ComponentDescription, type ComponentValidationReport } from "../../shared/definition";

export const CONTENT_VARIANTS = ["plain-text", "restricted-markdown-inline", "restricted-markdown-prose"] as const;
export type ContentVariant = typeof CONTENT_VARIANTS[number];

const useStyles = makeStyles({
  root: { minWidth: 0, overflowWrap: "anywhere" },
  prose: {
    "& p": { margin: `0 0 ${tokens.spacingVerticalS}` },
    "& p:last-child": { marginBottom: 0 },
    "& ul, & ol": { margin: `0 0 ${tokens.spacingVerticalS}`, paddingLeft: tokens.spacingHorizontalXXL },
  },
  link: { color: tokens.colorBrandForegroundLink, textDecorationLine: "underline", textUnderlineOffset: "2px" },
  code: { fontFamily: tokens.fontFamilyMonospace, color: tokens.colorBrandForeground1 },
});

export function safeContentHref(url: string): string | null {
  const trimmed = url.trim();
  return /^(https?:|mailto:|\/|#|\.)/i.test(trimmed) ? trimmed : null;
}

export function renderRestrictedMarkdownInline(
  value: string,
  classes?: { link?: string; code?: string },
): React.ReactNode {
  const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > last) nodes.push(value.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) nodes.push(<code className={classes?.code} key={key++}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link ? safeContentHref(link[2]) : null;
      nodes.push(link && href
        ? <a className={classes?.link} key={key++} href={href} target="_blank" rel="noreferrer noopener">{link[1]}</a>
        : token);
    } else if (token.startsWith("**")) nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < value.length) nodes.push(value.slice(last));
  return nodes.length === 0 ? value : nodes.length === 1 ? nodes[0] : nodes;
}

function renderRestrictedMarkdownProse(value: string, classes: { link: string; code: string }): React.ReactNode[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const nodes: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  let ordered = false;
  const flushParagraph = () => {
    if (paragraph.length) nodes.push(<p key={`p-${nodes.length}`}>{renderRestrictedMarkdownInline(paragraph.join(" "), classes)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!items.length) return;
    const children = items.map((item, index) => <li key={index}>{renderRestrictedMarkdownInline(item, classes)}</li>);
    nodes.push(ordered ? <ol key={`ol-${nodes.length}`}>{children}</ol> : <ul key={`ul-${nodes.length}`}>{children}</ul>);
    items = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushParagraph(); flushList(); continue; }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) { flushParagraph(); if (!ordered) flushList(); ordered = true; items.push(numbered[1]); continue; }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) { flushParagraph(); if (ordered) flushList(); ordered = false; items.push(bullet[1]); continue; }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return nodes;
}

export interface GovernedContentProps {
  value: string;
  variant: ContentVariant;
  className?: string;
  style?: React.CSSProperties;
}

export function GovernedContent({ value, variant, className, style }: GovernedContentProps): React.ReactElement {
  const styles = useStyles();
  const rootClassName = [styles.root, className].filter(Boolean).join(" ");
  if (variant === "plain-text") return <span className={rootClassName} style={style}>{value}</span>;
  if (variant === "restricted-markdown-inline") {
    return <span className={rootClassName} style={style}>{renderRestrictedMarkdownInline(value, styles)}</span>;
  }
  return <div className={`${rootClassName} ${styles.prose}`} style={style}>{renderRestrictedMarkdownProse(value, styles)}</div>;
}

export const Content: ProjectionView = ({ node }) => {
  const props = readProps(node);
  const variant = props.str("variant", "plain-text") as ContentVariant;
  return <GovernedContent {...componentRootProps(node)} value={props.str("value")} variant={variant} />;
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["value"],
  properties: {
    ...componentStylePropsSchema,
    value: { type: "string" },
    variant: { type: "string", enum: CONTENT_VARIANTS },
  },
} as const;
const description: ComponentDescription = {
  capability: "primitive:content",
  summary: "Renders plain text or governed Markdown with a closed formatting profile.",
  dataProp: "value",
  events: [],
  semanticTokens: [],
  defaultVariant: "plain-text",
  variants: [
    { value: "plain-text", summary: "Escaped text without Markdown interpretation.", useWhen: ["Titles, labels, statuses, and identifiers"] },
    { value: "restricted-markdown-inline", summary: "Inline emphasis, code, and safe links.", useWhen: ["List items and table cells need light emphasis"] },
    { value: "restricted-markdown-prose", summary: "Paragraphs and simple lists with restricted inline formatting.", useWhen: ["Summaries, card bodies, and evidence need readable prose"] },
  ],
  authoring: {
    useWhen: ["Text needs an explicit, governed formatting policy"],
    avoidWhen: ["Full document Markdown is required; use primitive:markdown", "Source code must be preserved verbatim; use primitive:source-viewer"],
    rules: ["Use plain-text for labels and identifiers", "Restricted variants do not support HTML, images, headings, tables, code fences, or diagrams"],
  },
};
export function validateContent(props: unknown): ComponentValidationReport {
  return runDeclarativeValidators([{ kind: "ajv-schema", schema, message: "Invalid primitive:content props", code: "primitive-content-schema" }], props as Json);
}
export const contentDefinition = defineComponent({
  description,
  version: "1.0.0",
  component: Content,
  getSchema: () => schema as unknown as Record<string, unknown>,
  validate: validateContent,
  materializeTrial: () => trialNode("primitive:content", { value: "**Validated** at runtime.", variant: "restricted-markdown-inline" }),
});