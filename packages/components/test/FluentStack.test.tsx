import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import {
  fluentComponentDefinitions,
  fluentComponentViews,
  fluentStackDefinition,
  fluentStackItemDefinition,
} from "../src/fluent";

test("fluent:stack exposes governed Fluent Stack layout props", () => {
  assert.equal(fluentComponentViews.stack, fluentStackDefinition.component);
  assert.equal(fluentComponentDefinitions.stack, fluentStackDefinition);
  assert.equal(fluentStackDefinition.validate({
    horizontal: true,
    horizontalAlign: "space-between",
    verticalAlign: "center",
    wrap: true,
    tokens: { childrenGap: 12 },
  }).ok, true);
  assert.equal(fluentStackDefinition.validate({ horizontalAlign: "auto" }).ok, false);
  assert.equal(fluentStackDefinition.validate({ tokens: { childrenGap: false } }).ok, false);

  const trial = fluentStackDefinition.materializeTrial();
  trial.props.horizontal = true;
  trial.props.horizontalAlign = "space-between";
  trial.props.verticalAlign = "center";
  trial.props.wrap = true;
  const Component = fluentStackDefinition.component;
  const markup = renderToStaticMarkup(
    <Component node={trial} emit={() => undefined} children={<span>Stack content</span>} />,
  );

  assert.match(markup, /display:flex/);
  assert.match(markup, /flex-direction:row/);
  assert.match(markup, /justify-content:space-between/);
  assert.match(markup, /align-items:center/);
  assert.match(markup, /flex-wrap:wrap/);
  assert.match(markup, /gap:12px/);
  assert.match(markup, /Stack content/);
});

test("fluent:stack-item controls one Stack child", () => {
  assert.equal(fluentComponentViews["stack-item"], fluentStackItemDefinition.component);
  assert.equal(fluentComponentDefinitions["stack-item"], fluentStackItemDefinition);
  assert.equal(fluentStackItemDefinition.validate({ grow: true, align: "center", order: 2 }).ok, true);
  assert.equal(fluentStackItemDefinition.validate({ align: "space-between" }).ok, false);

  const trial = fluentStackItemDefinition.materializeTrial();
  trial.props.grow = true;
  trial.props.align = "center";
  trial.props.tokens = { padding: 8 };
  const Component = fluentStackItemDefinition.component;
  const markup = renderToStaticMarkup(
    <Component node={trial} emit={() => undefined} children={<span>Item content</span>} />,
  );

  assert.match(markup, /flex-grow:1/);
  assert.match(markup, /align-self:center/);
  assert.match(markup, /padding:8px/);
  assert.match(markup, /Item content/);
  assert.throws(
    () => renderToStaticMarkup(<Component node={trial} emit={() => undefined} children={undefined} />),
    /requires exactly one child/,
  );
});