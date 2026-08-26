import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import {
  PaneWithTrigger,
  PaneWithTriggerBody,
  PaneWithTriggerFooter,
  PaneWithTriggerHeader,
  PaneWithTriggerTrigger,
  paneWithTriggerDefinition,
  materializePaneWithTriggerTrial,
} from "../src/shared";

test("drawer renders every authored child inside its single panel", () => {
  const node = materializePaneWithTriggerTrial();
  node.props.fabPosition = "top-right";

  const markup = renderToStaticMarkup(
    <PaneWithTrigger node={node} emit={() => {}}>
      <span>First child</span>
      <span>Second child</span>
    </PaneWithTrigger>,
  );

  assert.match(markup, /First child/);
  assert.match(markup, /Second child/);
  assert.doesNotMatch(markup, /<main/);
});

test("pane with trigger exposes drawer, floating-drawer, and dialog-modal variants", () => {
  assert.equal(paneWithTriggerDefinition.capability, "primitive:pane-with-trigger");
  assert.equal(paneWithTriggerDefinition.defaultVariant, "drawer");
  assert.deepEqual(
    paneWithTriggerDefinition.variants.map(({ value }) => value),
    ["drawer", "floating-drawer", "dialog-modal"],
  );
  assert.deepEqual(paneWithTriggerDefinition.slots, ["trigger", "header", "body", "footer"]);
  assert.equal(paneWithTriggerDefinition.validate({
    variant: "floating-drawer",
    title: "Scenario controls",
    fabPosition: "top-right",
    panelWidthPx: 320,
  }).ok, true);
  assert.equal(paneWithTriggerDefinition.validate({
    variant: "floating-drawer",
    title: "Scenario controls",
    panelWidthPx: 200,
  }).ok, false);
  assert.equal(paneWithTriggerDefinition.validate({
    variant: "drawer",
    title: "Sources",
    fabPosition: "bottom-left",
    defaultOpen: false,
  }).ok, true);
  assert.equal(paneWithTriggerDefinition.validate({
    variant: "dialog-modal",
    title: "Create Blueprint",
    triggerLabel: "New Blueprint",
    closeLabel: "Close",
  }).ok, true);
  assert.equal(paneWithTriggerDefinition.validate({
    variant: "dialog-modal",
    title: "Create Blueprint",
  }).ok, false);
  assert.equal(paneWithTriggerDefinition.validate({
    variant: "drawer",
    title: "Sources",
    layout: { slots: [{ key: "content", slot: "children", unknown: true }] },
  }).ok, false);
});

test("pane trigger section replaces the generated trigger content", () => {
  const node = materializePaneWithTriggerTrial();
  node.props.defaultOpen = false;

  const markup = renderToStaticMarkup(
    <PaneWithTrigger node={node} emit={() => {}}>
      <PaneWithTriggerTrigger><button type="button">Custom trigger</button></PaneWithTriggerTrigger>
      <PaneWithTriggerBody><span>Hidden content</span></PaneWithTriggerBody>
    </PaneWithTrigger>,
  );

  assert.match(markup, /<button[^>]*aria-label="Open Source reports"[^>]*>Custom trigger<\/button>/);
  assert.doesNotMatch(markup, /Hidden content/);
});

test("pane sections keep optional header and footer around the flexible body", () => {
  const node = materializePaneWithTriggerTrial();
  node.props.variant = "floating-drawer";

  const markup = renderToStaticMarkup(
    <PaneWithTrigger node={node} emit={() => {}}>
      <PaneWithTriggerHeader><span>Fixed header</span></PaneWithTriggerHeader>
      <PaneWithTriggerBody><span>Scrollable body</span></PaneWithTriggerBody>
      <PaneWithTriggerFooter><span>Fixed footer</span></PaneWithTriggerFooter>
    </PaneWithTrigger>,
  );

  assert.match(markup, /<header[^>]*>.*<span>Fixed header<\/span>.*<\/header>/);
  assert.match(markup, /Scrollable body/);
  assert.match(markup, /<footer[^>]*><span>Fixed footer<\/span><\/footer>/);
  assert.equal((markup.match(/<header/g) ?? []).length, 1);
  assert.doesNotMatch(markup, />Source reports<\/span>/);
});

test("floating drawer keeps the workspace undimmed", () => {
  const drawer = materializePaneWithTriggerTrial();
  const drawerMarkup = renderToStaticMarkup(
    <PaneWithTrigger node={drawer} emit={() => {}}>
      <span>Drawer content</span>
    </PaneWithTrigger>,
  );
  drawer.props.variant = "floating-drawer";
  const floatingMarkup = renderToStaticMarkup(
    <PaneWithTrigger node={drawer} emit={() => {}}>
      <span>Floating content</span>
    </PaneWithTrigger>,
  );

  assert.match(drawerMarkup, /data-pane-backdrop/);
  assert.doesNotMatch(floatingMarkup, /data-pane-backdrop/);
  assert.match(floatingMarkup, /Floating content/);
  assert.match(floatingMarkup, /Scenario controls|Source reports/);
  assert.match(floatingMarkup, /Close source reports/);
  assert.doesNotMatch(floatingMarkup, /aria-expanded="true"/);
});

test("floating drawer supports a stable pixel width", () => {
  const node = materializePaneWithTriggerTrial();
  node.props.variant = "floating-drawer";
  node.props.panelWidthPx = 320;

  const markup = renderToStaticMarkup(
    <PaneWithTrigger node={node} emit={() => {}}>
      <span>Floating content</span>
    </PaneWithTrigger>,
  );

  assert.match(markup, /--gik-drawer-width:320px/);
});

test("closed floating drawer renders a directional edge handle", () => {
  const node = materializePaneWithTriggerTrial();
  node.props.variant = "floating-drawer";
  node.props.defaultOpen = false;
  node.props.fabPosition = "top-right";

  const markup = renderToStaticMarkup(
    <PaneWithTrigger node={node} emit={() => {}}>
      <span>Hidden controls</span>
    </PaneWithTrigger>,
  );

  assert.match(markup, /Open Source reports/);
  assert.match(markup, /aria-expanded="false"/);
  assert.doesNotMatch(markup, /Hidden controls/);
  assert.doesNotMatch(markup, /Close source reports/);
});

test("pane with trigger remains optionally controlled", () => {
  const node = materializePaneWithTriggerTrial();
  node.props.defaultOpen = true;
  node.props.open = false;

  const markup = renderToStaticMarkup(
    <PaneWithTrigger node={node} emit={() => {}}>
      <span>Controlled content</span>
    </PaneWithTrigger>,
  );

  assert.doesNotMatch(markup, /Controlled content/);
  assert.match(markup, /aria-expanded="false"/);
});

test("dialog-modal renders its labeled trigger and closed modal surface", () => {
  const node = materializePaneWithTriggerTrial();
  node.props.variant = "dialog-modal";
  node.props.defaultOpen = false;
  node.props.triggerLabel = "New Blueprint";
  node.props.closeLabel = "Close new Blueprint form";

  const markup = renderToStaticMarkup(
    <PaneWithTrigger node={node} emit={() => {}}>
      <span>Blueprint form</span>
    </PaneWithTrigger>,
  );

  assert.match(markup, />New Blueprint<\/button>/);
  assert.doesNotMatch(markup, /Blueprint form/);
});