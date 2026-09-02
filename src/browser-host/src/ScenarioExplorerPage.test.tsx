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
  const passthrough = ({ children }: React.PropsWithChildren) => <>{children}</>;
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
    Popover: passthrough,
    PopoverSurface: element("div"),
    PopoverTrigger: passthrough,
    Subtitle1: element("h2"),
    Tab: element("button"),
    TabList: element("div"),
    Title1: element("h1"),
    ToggleButton: element("button"),
    makeStyles: (styles: Record<string, unknown>) => () =>
      Object.fromEntries(Object.keys(styles).map((key) => [key, key])),
  };
});

vi.mock("gik-components", () => ({
  PaneWithTriggerBody: ({ children }: React.PropsWithChildren) => <main data-pane-section="body">{children}</main>,
  PaneWithTriggerFooter: ({ children }: React.PropsWithChildren) => <footer data-pane-section="footer">{children}</footer>,
  PaneWithTriggerHeader: ({ children }: React.PropsWithChildren) => <header data-pane-section="header">{children}</header>,
  GikComponent: (props: React.PropsWithChildren<{
    kind: string;
    componentProps?: unknown;
    data?: unknown;
    onEvent?: (event: { name: string; payload: Record<string, unknown> }) => void;
  }>) => (
    <div
      data-gik-kind={props.kind}
      data-component-props={JSON.stringify(props.componentProps)}
      data-component-data={JSON.stringify(props.data)}
      onClick={() => props.onEvent?.({ name: "toggle", payload: { value: "acts" } })}
    >
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

  assert.match(text, /Add and value GOOG/);
  assert.match(text, /Context/);
  assert.match(text, /Scenarios/);
  assert.match(text, /Steps/);
  assert.doesNotMatch(text, /Add and value AAPL/);
  assert.equal(componentKinds.includes("primitive:infinite-canvas"), false);
  assert.ok(componentKinds.includes("primitive:pane-with-trigger"));
  assert.ok(componentKinds.includes("primitive:timer-button"));
  assert.ok(componentKinds.includes("semantic:process"));
  assert.ok(componentKinds.includes("fluent:toggle"));
  assert.ok(componentKinds.includes("primitive:growing-container"));
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
  });
  const timer = renderer.root.find(
    (node) => node.props["data-gik-kind"] === "primitive:timer-button",
  );
  assert.equal(JSON.parse(timer.props["data-component-props"]).countdownOnly, true);
  const stepsModeProgress = renderer.root.find(
    (node) => node.props["data-gik-kind"] === "semantic:process",
  );
  const stepProgressItems = JSON.parse(stepsModeProgress.props["data-component-data"]);
  assert.equal(stepProgressItems.length, 5);
  assert.ok(stepProgressItems.every((item: { icon: string }) => item.icon === "step"));
  assert.ok(stepProgressItems.every((item: { status: string }) => item.status === "upcoming"));
  assert.equal(
    renderer.root.findAll((node) => node.props.className === "journalCardIndex")[0]?.children[0],
    "1",
  );
  assert.equal(
    JSON.parse(stepsModeProgress.props["data-component-props"]).spec.title,
    "Rebalance and observe a portfolio",
  );
  const journalMode = renderer.root.find(
    (node) => node.props["data-gik-kind"] === "fluent:toggle",
  );
  const growingJournal = renderer.root.find(
    (node) => node.props["data-gik-kind"] === "primitive:growing-container",
  );
  assert.equal(
    growingJournal.findAll((node) => node.props["data-gik-kind"] === "fluent:toggle").length,
    0,
  );
  assert.deepEqual(JSON.parse(journalMode.props["data-component-props"]), {
    value: "steps",
    onValue: "acts",
    offValue: "steps",
    onLabel: "Acts",
    offLabel: "Steps",
    onIcon: "acts",
    offIcon: "steps",
    onTitle: "Acts view · switch to steps",
    offTitle: "Steps view · switch to acts",
    ariaLabel: "Show Scenario journal by steps or acts",
    size: "small",
  });
  await act(async () => {
    journalMode.props.onClick();
  });
  assert.ok(renderer.root.findAllByType("button").some((button) => button.children.includes("Acts")));
  assert.equal(
    renderer.root.find((node) => node.props["aria-label"] === "Pause Scenario").props.title,
    "Pause Scenario",
  );
  assert.equal(
    renderer.root.find((node) => node.props["aria-label"] === "Reset Scenario").props.title,
    "Reset Scenario",
  );
  const actsModeTimer = renderer.root.find(
    (node) => node.props["data-gik-kind"] === "primitive:timer-button",
  );
  assert.equal(JSON.parse(actsModeTimer.props["data-component-props"]).triggerImmediately, false);
  const actsModeProgress = renderer.root.find(
    (node) => node.props["data-gik-kind"] === "semantic:process",
  );
  const actProgressItems = JSON.parse(actsModeProgress.props["data-component-data"]);
  assert.equal(actProgressItems.length, 18);
  assert.deepEqual(
    new Set(actProgressItems.map((item: { icon: string }) => item.icon)),
    new Set(["event", "wait", "observe"]),
  );
  assert.ok(actProgressItems.every((item: { status: string }) => item.status === "upcoming"));
  assert.equal(
    renderer.root.findAll((node) => node.props["data-gik-kind"] === "primitive:growing-container").length,
    1,
  );
  assert.equal(
    renderer.root.findAll((node) => node.props["aria-label"] === "Act journal").length,
    1,
  );
  assert.equal(
    renderer.root.findAll((node) => node.props.className === "journalCardIndex")[0]?.children[0],
    "1",
  );
  const pane = renderer.root.find(
    (node) => node.props["data-gik-kind"] === "primitive:pane-with-trigger",
  );
  assert.equal(pane.findAll((node) => node.props["data-pane-section"] === "header").length, 1);
  assert.equal(pane.findAll((node) => node.props["data-pane-section"] === "body").length, 1);
  assert.equal(pane.findAll((node) => node.props["data-pane-section"] === "footer").length, 1);
  assert.equal(
    renderer.root.findAllByType("button")
      .some((button) => button.props["aria-label"] === "Show data flow"),
    true,
  );

  const tabList = renderer.root.find(
    (node) => typeof node.props.onTabSelect === "function",
  );
  assert.deepEqual(
    tabList.findAllByType("button").map((tab) => tab.children.join("")),
    ["Acts", "Context", "Scenarios"],
  );
  await act(async () => {
    tabList.props.onTabSelect({}, { value: "context" });
  });
  assert.equal(renderer.root.findAll((node) => node.props["aria-label"] === "Sample Contexts").length, 1);
  await act(async () => {
    tabList.props.onTabSelect({}, { value: "scenarios" });
  });
  assert.equal(renderer.root.findAll((node) => node.props["aria-label"] === "Blueprint selection").length, 1);
  const blueprintDropdown = renderer.root.find(
    (node) => node.props.id === "scenario-blueprint-select",
  );
  assert.ok(
    blueprintDropdown.findAll((node) => typeof node.props.value === "string")
      .every((option) => option.props.disabled !== true),
  );
  const scenarioList = renderer.root.find(
    (node) => node.props["data-gik-kind"] === "fluent:list",
  );
  const scenarioItems = JSON.parse(scenarioList.props["data-component-data"]);
  assert.equal(scenarioItems[0].label, "Rebalance and observe a portfolio");
  assert.match(scenarioItems[0].description, /Adds GOOG and AAPL/);

  await act(async () => renderer.unmount());
});
