import assert from "node:assert/strict";
import { test } from "vitest";

import {
  canonicalizeHostUrl,
  readHostQuery,
  writeBlueprintQuery,
} from "./host-query";

test("host query uses durable storage except on the in-memory route", () => {
  assert.equal(readHostQuery("?b=samples-overview", "/").durableEnabled, true);
  assert.equal(readHostQuery("?b=samples-overview", "/in-memory/").durableEnabled, false);
  assert.equal(readHostQuery("?b=samples-overview", "/gik-samples/in-memory/").durableEnabled, false);
  assert.equal(
    readHostQuery("?b=samples-overview", "/gik-samples/in-memory/index.html").durableEnabled,
    false,
  );
  assert.equal(readHostQuery("?b=samples-overview", "/not-in-memory/").durableEnabled, true);
  assert.equal(readHostQuery("", "/in-memory/provisioning/").durableEnabled, true);
});

test("Blueprint query preserves the complete route while removing obsolete Scenario selections", () => {
  assert.equal(
    writeBlueprintQuery(
      "https://example.test/gik-samples/scenarios/?b=portfolio-tracker-new&scenario=replace-holdings&context=mock-desktop#journal",
      "ai-agent",
    ),
    "https://example.test/gik-samples/scenarios/?b=ai-agent#journal",
  );
});

test("host query recognizes dedicated test and scenario tooling routes", () => {
  assert.equal(readHostQuery("", "/tests/").testsEnabled, true);
  assert.equal(readHostQuery("", "/gik-samples/tests/index.html").testsEnabled, true);
  assert.equal(readHostQuery("", "/scenarios/").scenariosEnabled, true);
  assert.equal(readHostQuery("", "/gik-samples/scenarios/index.html").scenariosEnabled, true);
  assert.equal(readHostQuery("", "/").scenariosEnabled, false);
  assert.equal(readHostQuery("", "/provisioning/").provisioningEnabled, true);
  assert.equal(readHostQuery("", "/in-memory/provisioning/index.html").provisioningEnabled, true);
  assert.equal(
    canonicalizeHostUrl("https://example.test/gik-samples/in-memory/provisioning/"),
    "https://example.test/gik-samples/provisioning/",
  );
  assert.equal(
    readHostQuery("?context=mock-desktop", "/scenarios/").externalContext,
    undefined,
  );
});

test("host query selects Blueprints with the canonical b parameter", () => {
  assert.equal(
    readHostQuery("?b=live-workspace-soc").targetId,
    "live-workspace-soc",
  );
  assert.deepEqual(
    readHostQuery("?b=ai-agent&context=%7B%22ai%22%3A%22copilot%22%7D").externalContext,
    { ai: "copilot" },
  );
  assert.deepEqual(
    readHostQuery(`?b=portfolio-tracker-new&context=${encodeURIComponent(JSON.stringify({
      "intelligence-model": "semantic",
      "market-prices": "live",
      semantic: "rich-components",
      view: "mobile",
      limits: { positions: 10 },
    }))}`).externalContext,
    {
      "intelligence-model": "semantic",
      "market-prices": "live",
      semantic: "rich-components",
      view: "mobile",
      limits: { positions: 10 },
    },
  );
  assert.deepEqual(
    readHostQuery("?b=incident-analysis-new-shell&context=%7B%22model%22%3A%22refinement%22%2C%22source-report%22%3A%22identity-compromise%22%7D").externalContext,
    { model: "refinement", "source-report": "identity-compromise" },
  );
  assert.equal(readHostQuery("?b=ai-agent&ai=copilot").externalContext, undefined);
  assert.throws(
    () => readHostQuery("?b=ai-agent&context=copilot"),
    /URL-encoded JSON object/,
  );
  assert.throws(
    () => readHostQuery("?b=ai-agent&context=%5B%22copilot%22%5D"),
    /URL-encoded JSON object/,
  );
});

test("host query reports no Blueprint when no explicit selection names one", () => {
  assert.equal(readHostQuery("").targetId, null);
  assert.equal(readHostQuery("?durable=1").targetId, null);
  assert.equal(readHostQuery("?demo=1&gik=1").targetId, null);
  assert.equal(readHostQuery("?b=").targetId, null);
  assert.equal(readHostQuery("?b=%20").targetId, null);
  assert.equal(
    readHostQuery("?context=%7B%22mode%22%3A%22embedded%22%7D").targetId,
    null,
  );
  assert.equal(
    canonicalizeHostUrl("https://example.test/?durable=1"),
    "https://example.test/",
  );
  assert.equal(
    canonicalizeHostUrl("https://example.test/?b=&durable=1"),
    "https://example.test/",
  );
});
