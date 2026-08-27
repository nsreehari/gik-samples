import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { test } from "vitest";
import { getSampleBlueprintCatalog } from "../../../bootstrap/catalog/blueprint-catalog";
import { createBrowserProvisioningProfileStore } from "./profile-storage";
import {
  normalizeCompanionPort,
  ProvisioningCompanionClient,
} from "./companion-client";
import {
  defaultProvisioningProfile,
  generateProvisioningPlan,
} from "./provisioning";

test("selected Blueprint identity and user profile deterministically lower through lifecycle transforms", () => {
  const blueprint = getSampleBlueprintCatalog().entries["ai-agent"];
  const profile = {
    ...defaultProvisioningProfile(blueprint),
    agentId: "AnyBlueprintAgent",
    description: "A user-owned overlay.",
    instructions: "Use only verified repository facts.",
  };
  const first = generateProvisioningPlan(blueprint, profile);
  const second = generateProvisioningPlan(blueprint, profile);
  assert.deepEqual(first, second);
  assert.equal(first.blueprint.id, blueprint.payload.id);
  assert.equal(first.provider, "copilot");
  assert.match(first.files[0].content, /name: AnyBlueprintAgent/);
  assert.match(first.files[0].content, new RegExp(`Governed Blueprint: ${blueprint.payload.id}@`));

  const foundry = generateProvisioningPlan(blueprint, { ...profile, provider: "foundry" });
  assert.equal(foundry.provider, "foundry");
  assert.equal(foundry.agents[0].definition.kind, "prompt");
  assert.match(foundry.agents[0].definition.instructions, /Use only verified repository facts/);
});

test("provisioning profiles persist on durable storage and remain overlays keyed by Blueprint ID", async () => {
  const previous = globalThis.indexedDB;
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDB });
  try {
    const blueprint = getSampleBlueprintCatalog().entries["ai-agent"];
    const profile = {
      ...defaultProvisioningProfile(blueprint),
      description: "Persisted user overlay.",
    };
    const first = createBrowserProvisioningProfileStore(true);
    await first.write(profile);
    const reopened = createBrowserProvisioningProfileStore(true);
    assert.deepEqual(await reopened.read(blueprint.payload.id), profile);
    assert.equal(await reopened.read("blueprint-studio"), null);
    assert.equal(getSampleBlueprintCatalog().entries["ai-agent"], blueprint);
  } finally {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: previous });
  }
});

test("in-memory provisioning profiles do not survive a fresh storage factory", async () => {
  const blueprint = getSampleBlueprintCatalog().entries["ai-agent"];
  const profile = defaultProvisioningProfile(blueprint);
  const first = createBrowserProvisioningProfileStore(false);
  await first.write(profile);
  assert.deepEqual(await first.read(blueprint.payload.id), profile);
  assert.equal(await createBrowserProvisioningProfileStore(false).read(blueprint.payload.id), null);
});

test("local companion configuration accepts only a loopback port", () => {
  assert.equal(normalizeCompanionPort("7801"), 7801);
  assert.equal(new ProvisioningCompanionClient("43110").endpoint, "http://127.0.0.1:43110");
  assert.throws(() => normalizeCompanionPort("localhost:7801"), /whole number/);
  assert.throws(() => normalizeCompanionPort("0"), /between 1 and 65535/);
  assert.throws(() => normalizeCompanionPort("65536"), /between 1 and 65535/);
});
