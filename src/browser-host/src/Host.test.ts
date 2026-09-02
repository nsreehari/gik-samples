import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

const capturedProps = vi.hoisted(() => ({
  externalContext: undefined as unknown,
  appRootRenders: 0,
  appRootDurableEnabled: undefined as boolean | undefined,
  hostRenders: 0,
}));

vi.mock("gik-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gik-react")>();
  return {
    ...actual,
    BlueprintHost: (props: { externalContext?: unknown }) => {
      capturedProps.externalContext = props.externalContext;
      capturedProps.hostRenders += 1;
      return null;
    },
  };
});

vi.mock("gik-react/durable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gik-react/durable")>();
  return {
    ...actual,
    BlueprintHost: (props: { externalContext?: unknown }) => {
      capturedProps.externalContext = props.externalContext;
      capturedProps.hostRenders += 1;
      return null;
    },
  };
});

// The application root page runs a whole embedded Blueprint of its own; these tests are about which
// route the host selects, so it is stubbed here and exercised for real in AppRootPage.test.tsx.
vi.mock("./AppRootPage", () => ({
  AppRootPage: ({ durableEnabled }: { durableEnabled: boolean }) => {
    capturedProps.appRootRenders += 1;
    capturedProps.appRootDurableEnabled = durableEnabled;
    return null;
  },
}));

function withLocation(href: string, run: () => void): void {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { href, search: new URL(href).search, pathname: new URL(href).pathname } },
  });
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
}

import "fake-indexeddb/auto";
import type { BlueprintProposalReceipt } from "gik-blueprint-agent-host";
import type { UseProposal } from "./runtime/blueprint-agent-lifecycle";
import { Host, createSampleBlueprintProposalStore } from "./Host";
import { getSampleBlueprintCatalog } from "../../bootstrap/catalog/blueprint-catalog";
import { createBrowserBlueprintStorageConnectionFactory } from "./runtime/blueprint-storage";

const receipt = (id: string): BlueprintProposalReceipt<UseProposal> => ({
  id,
  proposal: {
    id: `proposal-${id}`,
    capability: "use-blueprint",
    target: { kind: "blueprint-instance", id: "incident-analysis-new-shell", instanceId: "default" },
    actions: [{ kind: "analyze-report", payload: { operation: "analyzeReportBlueprint" } }],
    createdAt: "2026-08-05T00:00:00.000Z",
  },
  actor: { id: "ai-agent" },
  status: "admitted",
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
  audit: [],
});

test("sample host selects isolated memory or persistent IndexedDB proposal stores", async () => {
  const memory = createSampleBlueprintProposalStore({
    durableEnabled: false,
    blueprintId: "incident-analysis-new-shell",
  });

  await memory.create(receipt("memory"));
  const freshMemory = createSampleBlueprintProposalStore({
    durableEnabled: false,
    blueprintId: "incident-analysis-new-shell",
  });
  assert.equal(await freshMemory.get("memory"), undefined);

  const databaseName = `gik-host-test-${crypto.randomUUID()}`;
  const durable = createSampleBlueprintProposalStore({
    durableEnabled: true,
    blueprintId: "incident-analysis-new-shell",
    databaseName,
  });
  await durable.create(receipt("durable"));
  const reopened = createSampleBlueprintProposalStore({
    durableEnabled: true,
    blueprintId: "incident-analysis-new-shell",
    databaseName,
  });
  assert.deepEqual(await reopened.get("durable"), receipt("durable"));
});

test("sample host bootstraps isolated memory or persistent IndexedDB Blueprint storage", async () => {
  const instanceId = `incident-assets:${crypto.randomUUID()}`;
  const identity = { blueprintId: "incident-analysis-assets", instanceId };
  const request = {
    capability: "kv" as const,
    operation: "write" as const,
    args: ["asset:test", { persisted: true }],
  };

  const memory = createBrowserBlueprintStorageConnectionFactory(false)(identity);
  const memorySources = await memory.api.dispatch({
    ref: memory.ref,
    capability: "kv",
    operation: "read",
    args: ["index:sources"],
  });
  assert.ok(Array.isArray(memorySources));
  assert.ok(memorySources.some((source) =>
    source && typeof source === "object" && "id" in source && source.id === "identity-compromise"));
  await memory.api.dispatch({ ...request, ref: memory.ref });
  const freshMemory = createBrowserBlueprintStorageConnectionFactory(false)(identity);
  assert.equal(await freshMemory.api.dispatch({
    ref: freshMemory.ref,
    capability: "kv",
    operation: "read",
    args: ["asset:test"],
  }), null);

  const durable = createBrowserBlueprintStorageConnectionFactory(true)(identity);
  const durableSource = await durable.api.dispatch({
    ref: durable.ref,
    capability: "kv",
    operation: "read",
    args: ["source:identity-compromise"],
  });
  assert.ok(durableSource && typeof durableSource === "object" && !Array.isArray(durableSource));
  const sourceRecord = durableSource as Record<string, unknown>;
  assert.equal(sourceRecord.id, "identity-compromise");
  assert.equal(sourceRecord.label, "Identity and cloud resource compromise");
  assert.match(String(sourceRecord.content), /Investigation Report/);
  await durable.api.dispatch({ ...request, ref: durable.ref });
  const reopened = createBrowserBlueprintStorageConnectionFactory(true)(identity);
  assert.deepEqual(await reopened.api.dispatch({
    ref: reopened.ref,
    capability: "kv",
    operation: "read",
    args: ["asset:test"],
  }), { persisted: true });
});

test("an explicit ?b= selection opens that Blueprint's full host route", () => {
  capturedProps.appRootRenders = 0;
  capturedProps.hostRenders = 0;
  withLocation("https://example.test/?b=blueprint-studio", () => {
    renderToStaticMarkup(React.createElement(Host));
  });
  assert.equal(capturedProps.appRootRenders, 0);
  assert.equal(capturedProps.hostRenders, 1);
  // blueprint-studio's own authored launch defaults select its normal presentation mode, so the
  // full route stays exactly the Studio it has always been.
  assert.deepEqual(capturedProps.externalContext, { mode: "normal" });
});

test("no Blueprint selection renders the application root page instead of a default Blueprint", () => {
  capturedProps.appRootRenders = 0;
  capturedProps.hostRenders = 0;
  withLocation("https://example.test/", () => {
    renderToStaticMarkup(React.createElement(Host));
  });
  assert.equal(capturedProps.appRootRenders, 1);
  assert.equal(capturedProps.hostRenders, 0);
  assert.equal(capturedProps.appRootDurableEnabled, true);
  // The catalog still declares a default Blueprint; the root route deliberately does not open it.
  assert.equal(getSampleBlueprintCatalog().defaultBlueprint, "portfolio-tracker-new");
});

test("the in-memory application root explicitly disables durable storage", () => {
  capturedProps.appRootRenders = 0;
  capturedProps.hostRenders = 0;
  capturedProps.appRootDurableEnabled = undefined;
  withLocation("https://example.test/in-memory/", () => {
    renderToStaticMarkup(React.createElement(Host));
  });
  assert.equal(capturedProps.appRootRenders, 1);
  assert.equal(capturedProps.hostRenders, 0);
  assert.equal(capturedProps.appRootDurableEnabled, false);
});

test("portfolio tracker uses Blueprint-authored launch defaults", () => {
  withLocation("https://example.test/?b=portfolio-tracker-new&gik=1", () => {
    renderToStaticMarkup(React.createElement(Host));
    assert.deepEqual(capturedProps.externalContext, {
      ai: "foundry",
      "intelligence-model": "simple",
      "market-prices": "mock",
      semantic: "simple-markdown",
      view: "desktop",
    });
  });
});