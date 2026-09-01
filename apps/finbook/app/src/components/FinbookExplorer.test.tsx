import assert from "node:assert/strict";
import React from "react";
import { test } from "vitest";
import { createGikComponentDeclarativeBundle, GikComponent } from "@gik-ai/components";
import { primitiveComponentCapabilities } from "@gik-ai/components/primitives";
import { unwrap } from "@gik-ai/kernel";

import {
  FinbookExplorer,
  financeComponentViews,
  finbookExplorerDefinition,
} from "./FinbookExplorer";
import { financeComponentCapabilities } from "./FinbookExplorerContract";
import { finbookPrimitiveComponentCapabilities } from "./PrimitiveComponentContracts";

test("Finbook explorer is a complete declarative component contract", () => {
  const trial = finbookExplorerDefinition.materializeTrial();

  assert.equal(financeComponentViews["finbook-explorer"], FinbookExplorer);
  assert.equal(finbookExplorerDefinition.validate(trial.props).ok, true);
  assert.ok(financeComponentCapabilities["finbook-explorer"].propsSchema);
  assert.deepEqual(finbookExplorerDefinition.events, []);
});

test("Finbook's headless form contract matches the governed primitive catalog", () => {
  assert.deepEqual(
    finbookPrimitiveComponentCapabilities.form,
    primitiveComponentCapabilities.form,
  );
});

test("Finbook explorer composes the governed Fluent table", () => {
  const trial = finbookExplorerDefinition.materializeTrial();
  const rendered = FinbookExplorer({
    node: trial,
    emit: () => undefined,
    children: undefined,
  }) as React.ReactElement<{ children: React.ReactNode }>;
  const children = React.Children.toArray(rendered.props.children);
  const table = children.find((child) => React.isValidElement(child) && child.type === GikComponent);

  assert.ok(React.isValidElement(table));
  assert.equal(table.props.kind, "fluent:table");
  assert.deepEqual(table.props.componentProps.rows, [
    {
      id: "transaction-1",
      cells: {
        id: "transaction-1",
        date: "2025-04-01",
        security: "ACME",
      },
    },
  ]);
});

test("Finbook explorer preserves columns from heterogeneous transaction rows", () => {
  const trial = finbookExplorerDefinition.materializeTrial();
  trial.props.result = {
    title: "Stock transactions",
    rows: [
      { id: "purchase-1", pricePerUnit: 100 },
      { id: "sale-1", saleAmount: 125, purchaseLots: [{ id: "purchase-1" }] },
    ],
  };
  const rendered = FinbookExplorer({
    node: trial,
    emit: () => undefined,
    children: undefined,
  }) as React.ReactElement<{ children: React.ReactNode }>;
  const table = React.Children.toArray(rendered.props.children)
    .find((child) => React.isValidElement(child) && child.type === GikComponent);

  assert.ok(React.isValidElement(table));
  assert.deepEqual(
    table.props.componentProps.columns.map((column: { id: string }) => column.id),
    ["id", "pricePerUnit", "saleAmount", "purchaseLots"],
  );
});

test("Finbook explorer is addressable through GikComponentDeclarative with its catalog", () => {
  const trial = finbookExplorerDefinition.materializeTrial();
  const bundle = createGikComponentDeclarativeBundle({
    id: trial.id,
    capability: trial.capability,
    props: trial.props,
  }, {
    state: {},
    contexts: {},
    effectHandlers: {},
    resolveCapabilityDescriptors: (from) => from === "finance" ? financeComponentCapabilities : undefined,
  });
  const vocabulary = unwrap(bundle.vocabulary);

  assert.deepEqual(vocabulary.externals?.projectionViews, {
    finance: { from: "finance", use: ["finbook-explorer"] },
  });
  assert.deepEqual(
    vocabulary.capabilities["finance:finbook-explorer"],
    financeComponentCapabilities["finbook-explorer"],
  );
});
