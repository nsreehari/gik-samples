import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { test, vi } from "vitest";

vi.mock("@fluentui/react-components", async () => {
  const actual = await vi.importActual<typeof import("@fluentui/react-components")>(
    "@fluentui/react-components",
  );
  const element = (tag: keyof React.JSX.IntrinsicElements) =>
    ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(tag, props, children);
  return {
    ...actual,
    Badge: element("span"),
    Body1: element("p"),
    Button: element("button"),
    Caption1: element("span"),
    Dropdown: element("div"),
    Input: element("input"),
    Label: element("label"),
    Option: element("div"),
    Subtitle1: element("h2"),
    Tab: element("button"),
    TabList: element("div"),
    Title1: element("h1"),
    makeStyles: (styles: Record<string, unknown>) => () =>
      Object.fromEntries(Object.keys(styles).map((key) => [key, key])),
  };
});

vi.mock("@gik/components", () => ({
  GikComponent: (props: React.PropsWithChildren<{ kind: string; componentProps?: unknown }>) => (
    <div data-gik-kind={props.kind} data-component-props={JSON.stringify(props.componentProps)}>
      {props.children}
    </div>
  ),
}));

import { ScenarioExplorerPage } from "./ScenarioExplorerPage";

test("Scenario Explorer presents a full-screen surface with floating scenario controls", async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ScenarioExplorerPage />);
    await Promise.resolve();
  });

  const text = renderer.root.findAll(() => true)
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === "string")
    .join(" ");
  const componentKinds = renderer.root.findAll((node) => typeof node.props["data-gik-kind"] === "string")
    .map((node) => node.props["data-gik-kind"]);

  assert.match(text, /Add GOOG and observe its market price/);
  assert.match(text, /Context/);
  assert.match(text, /Steps/);
  assert.match(text, /Acts/);
  assert.match(text, /Step 1 of/);
  assert.match(text, /Automatic · 2 seconds/);
  assert.equal(componentKinds.includes("primitive:infinite-canvas"), false);
  assert.ok(componentKinds.includes("primitive:pane-with-trigger"));
  assert.ok(componentKinds.includes("primitive:timer-button"));
  assert.ok(componentKinds.includes("semantic:process"));
  const scenarioControls = renderer.root.find(
    (node) => node.props["data-gik-kind"] === "primitive:pane-with-trigger",
  );
  assert.deepEqual(JSON.parse(scenarioControls.props["data-component-props"]), {
    variant: "floating-drawer",
    title: "Scenario controls",
    ariaLabel: "Scenario controls",
    fabPosition: "top-right",
    openLabel: "Open scenario controls",
    closeLabel: "Close scenario controls",
    panelWidthPx: 320,
    style: { top: "50px", bottom: "50px" },
  });
  assert.equal(
    renderer.root.findAllByType("button")
      .some((button) => button.props["aria-label"] === "Show data flow"),
    true,
  );

  await act(async () => renderer.unmount());
});
