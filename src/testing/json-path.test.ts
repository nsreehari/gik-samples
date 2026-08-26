import assert from "node:assert/strict";
import { test } from "vitest";

import { jsonValuesEqual } from "../shared/json-path";

test("JSON structural equality ignores object key insertion order", () => {
  assert.equal(jsonValuesEqual(
    {
      model: "mock",
      nested: {
        flags: { enabled: true, visible: false },
        values: [1, { first: "A", second: "B" }],
      },
    },
    {
      nested: {
        values: [1, { second: "B", first: "A" }],
        flags: { visible: false, enabled: true },
      },
      model: "mock",
    },
  ), true);
});

test("JSON structural equality preserves array order and exact object shape", () => {
  assert.equal(jsonValuesEqual(
    { values: ["first", "second"] },
    { values: ["second", "first"] },
  ), false);
  assert.equal(jsonValuesEqual(
    { model: "mock" },
    { model: "mock", view: "desktop" },
  ), false);
  assert.equal(jsonValuesEqual(null, {}), false);
});
