import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { contentDefinition } from "../src/primitives/content";
import { listDefinition } from "../src/primitives/list";
import { tableDefinition } from "../src/primitives/table";

function render(definition: typeof contentDefinition | typeof listDefinition | typeof tableDefinition, props: Record<string, unknown>): string {
  const node = definition.materializeTrial();
  node.props = props as typeof node.props;
  const Component = definition.component;
  return renderToStaticMarkup(<Component node={node} emit={() => undefined} children={undefined} />);
}

test("primitive:content enforces its three governed text profiles", () => {
  const plain = render(contentDefinition, { value: "**Plain** `text`", variant: "plain-text" });
  assert.match(plain, /\*\*Plain\*\*/);
  assert.doesNotMatch(plain, /<strong>/);

  const inline = render(contentDefinition, {
    value: "**Confirmed** with `runtime` [safe](https://example.com) [unsafe](javascript:alert(1))",
    variant: "restricted-markdown-inline",
  });
  assert.match(inline, /<strong>Confirmed<\/strong>/);
  assert.match(inline, /<code[^>]*>runtime<\/code>/);
  assert.match(inline, /href="https:\/\/example.com"/);
  assert.doesNotMatch(inline, /href="javascript:/);

  const prose = render(contentDefinition, {
    value: "First **paragraph**.\n\n- One\n- Two\n\n# Not a heading",
    variant: "restricted-markdown-prose",
  });
  assert.match(prose, /<p>First <strong>paragraph<\/strong>\.<\/p>/);
  assert.match(prose, /<ul>/);
  assert.doesNotMatch(prose, /<h1>/);
  assert.match(prose, /# Not a heading/);
});

test("primitive:list fixes every item to restricted inline Markdown", () => {
  const markup = render(listDefinition, {
    ordered: true,
    items: ["Apply the **fix**.", "Run the `test`."],
  });
  assert.match(markup, /<ol/);
  assert.match(markup, /<strong>fix<\/strong>/);
  assert.match(markup, /<code[^>]*>test<\/code>/);
  assert.equal(listDefinition.validate({ items: ["valid", 42] }).ok, false);
});

test("primitive:table keeps headers plain and cells restricted inline Markdown", () => {
  const markup = render(tableDefinition, {
    headers: ["**Finding**", "Status"],
    rows: [["**SQL injection**", "`Exploitable`"]],
  });
  assert.match(markup, /<th[^>]*><span[^>]*>\*\*Finding\*\*<\/span><\/th>/);
  assert.match(markup, /<td><span[^>]*><strong>SQL injection<\/strong><\/span><\/td>/);
  assert.match(markup, /<code[^>]*>Exploitable<\/code>/);
  assert.equal(tableDefinition.validate({ rows: [["valid", 42]] }).ok, false);
});