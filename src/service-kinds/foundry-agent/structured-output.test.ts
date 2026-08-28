import assert from "node:assert/strict";
import { test } from "vitest";

import { getSampleBlueprintCatalog } from "../../bootstrap/catalog/blueprint-catalog";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectProviderSchemas(value: unknown, schemas: unknown[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectProviderSchemas(entry, schemas));
    return;
  }
  if (!isRecord(value)) return;
  if (value.code === "provider-structured-output" && value.schema !== undefined) {
    schemas.push(value.schema);
  }
  Object.values(value).forEach((entry) => collectProviderSchemas(entry, schemas));
}

function assertStrictObjectSchemas(value: unknown, path = "schema"): void {
  if (!isRecord(value)) return;
  if (value.type === "object") {
    assert.equal(
      value.additionalProperties,
      false,
      `${path} must set additionalProperties to false for Foundry strict structured output`,
    );
  }
  if (value.type === "array") {
    assert.notEqual(value.items, undefined, `${path} must declare items for Foundry strict structured output`);
  }
  if (isRecord(value.properties)) {
    Object.entries(value.properties).forEach(([name, property]) =>
      assertStrictObjectSchemas(property, `${path}.properties.${name}`));
  }
  if (value.items !== undefined) assertStrictObjectSchemas(value.items, `${path}.items`);
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    const alternatives = value[keyword];
    if (Array.isArray(alternatives)) {
      alternatives.forEach((alternative, index) =>
        assertStrictObjectSchemas(alternative, `${path}.${keyword}[${index}]`));
    }
  }
}

test("repository provider response schemas satisfy Foundry strict object requirements", () => {
  const schemas: unknown[] = [];
  Object.values(getSampleBlueprintCatalog().seedEntries).forEach((blueprint) =>
    collectProviderSchemas(blueprint, schemas));

  assert.ok(schemas.length > 0);
  schemas.forEach((schema, index) => assertStrictObjectSchemas(schema, `schemas[${index}]`));
});
