import assert from "node:assert/strict";
import { test } from "vitest";

import type { NativeServiceDeclaration } from "@gik-ai/kernel";
import { getSampleBlueprintCatalog } from "../bootstrap/catalog/blueprint-catalog";
import {
  authorizeTrustedServiceEndpoint,
  trustedServiceEndpointOrigins,
} from "../bootstrap/catalog/trusted-service-endpoints";
import { createSampleServiceKindRegistry } from ".";

interface CollectedService {
  blueprintId: string;
  serviceId: string;
  location: string;
  declaration: NativeServiceDeclaration;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isServiceDeclaration(value: unknown): value is NativeServiceDeclaration {
  return isRecord(value)
    && typeof value.kind === "string"
    && typeof value.version === "string"
    && isRecord(value.operations);
}

function isBlueprintServiceDeclaration(value: unknown): boolean {
  return isRecord(value)
    && isRecord(value.blueprint)
    && typeof value.blueprint.$ref === "string"
    && typeof value.version === "string"
    && isRecord(value.operations);
}

function collectServices(): CollectedService[] {
  const services: CollectedService[] = [];
  const collect = (blueprintId: string, location: string, value: unknown) => {
    if (value === undefined) return;
    assert.equal(isRecord(value), true, `${blueprintId}:${location} must be a service declaration map`);
    if (!isRecord(value)) return;
    Object.entries(value).forEach(([serviceId, declaration]) => {
      assert.equal(
        isServiceDeclaration(declaration) || isBlueprintServiceDeclaration(declaration),
        true,
        `${blueprintId}:${location}:${serviceId} must be a native or Blueprint-backed service declaration`,
      );
      if (isServiceDeclaration(declaration)) {
        services.push({ blueprintId, serviceId, location, declaration });
      }
    });
  };

  Object.values(getSampleBlueprintCatalog().seedEntries).forEach((blueprint) => {
    const blueprintId = blueprint.payload.id;
    collect(blueprintId, "payload.services", blueprint.payload.services);
    const recipes = blueprint.payload.serviceRecipes;
    if (!Array.isArray(recipes)) return;
    recipes.forEach((recipe) => {
      if (!isRecord(recipe) || !Array.isArray(recipe.implementationPrograms)) return;
      recipe.implementationPrograms.forEach((program) => {
        if (!isRecord(program)) return;
        collect(
          blueprintId,
          `serviceRecipes.${String(recipe.id)}.${String(program.id)}`,
          program.services,
        );
      });
    });
  });
  return services;
}

function label(service: CollectedService): string {
  return `${service.blueprintId}:${service.location}:${service.serviceId}`;
}

function secretFieldPaths(value: unknown, path = "config"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => secretFieldPaths(item, `${path}[${index}]`));
  }
  if (!isRecord(value)) return [];

  const secretFieldNames = /^(?:apiKey|accessKey|functionKey|clientSecret|password|bearerToken)$/i;
  return Object.entries(value).flatMap(([key, child]) => [
    ...(secretFieldNames.test(key) ? [`${path}.${key}`] : []),
    ...secretFieldPaths(child, `${path}.${key}`),
  ]);
}

function parseCredentialFreeTarget(value: string, targetLabel: string): URL {
  const target = new URL(value);
  assert.equal(target.username || target.password, "", `${targetLabel} contains credentials`);
  assert.equal(target.search, "", `${targetLabel} must not contain query parameters`);
  assert.equal(target.hash, "", `${targetLabel} must not contain a fragment`);
  return target;
}

test("all repository Blueprint services satisfy their registered kind contracts", async () => {
  const catalog = getSampleBlueprintCatalog();
  const trustedEndpoints = trustedServiceEndpointOrigins(getSampleBlueprintCatalog().seedEntries);
  const registry = createSampleServiceKindRegistry({
    hostCapabilities: [
      "copilot-executor",
      "workspace-resolver",
      "foundry-executor",
      "credential-resolver",
      "http-executor",
      "mcp-executor",
    ],
    durableStorageConnections: {
      "blueprint-state": {
        ref: "test:blueprint-state",
        api: { dispatch: async () => null },
      },
    },
    resolveCredential: async () => "test-credential",
    authorizeEndpoint: (kind, endpoint) =>
      authorizeTrustedServiceEndpoint(trustedEndpoints, kind, endpoint),
    execute: async () => null,
  });
  const services = collectServices();

  const serviceCounts = Object.fromEntries(
    Object.values(catalog.seedEntries).map((blueprint) => [blueprint.payload.id, 0]),
  );
  services.forEach((service) => {
    serviceCounts[service.blueprintId] += 1;
  });
  assert.deepEqual(serviceCounts, {
    "ai-agent": 2,
    "blueprint-studio": 0,
    "blueprint-studio-crud": 1,
    "incident-analysis-assets": 1,
    "incident-analysis-new-shell": 3,
    "portfolio-intelligence-assets": 1,
    "portfolio-tracker-mock": 0,
    "portfolio-tracker-new": 6,
  });

  for (const service of services) {
    assert.equal(registry.has(service.declaration.kind), true, `${label(service)} has an unknown kind`);
    const report = await registry.validate(service.declaration);
    assert.equal(report.ok, true, `${label(service)}: ${report.errors?.join("; ")}`);
  }
});

test("repository Blueprint service configuration owns concrete trusted targets and credentials", () => {
  const trustedEndpoints = trustedServiceEndpointOrigins(getSampleBlueprintCatalog().seedEntries);
  const repeatedConfigs = new Map<string, string>();

  for (const service of collectServices()) {
    const config = isRecord(service.declaration.config) ? service.declaration.config : {};
    assert.equal(JSON.stringify(config).includes("${"), false, `${label(service)} contains host substitution`);
    assert.deepEqual(secretFieldPaths(config), [], `${label(service)} contains literal secret fields`);
    if (typeof config.endpoint === "string") {
      const endpoint = parseCredentialFreeTarget(config.endpoint, `${label(service)} endpoint`);
      assert.equal(endpoint.protocol, "https:", `${label(service)} endpoint must use HTTPS`);
      assert.equal(
        authorizeTrustedServiceEndpoint(trustedEndpoints, service.declaration.kind, endpoint),
        true,
        `${label(service)} endpoint is not trusted for ${service.declaration.kind}`,
      );
      assert.match(
        String(config.credentialRef ?? ""),
        /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/,
        `${label(service)} must use a logical credentialRef`,
      );
    }

    if (typeof config.projectEndpoint === "string") {
      const projectEndpoint = parseCredentialFreeTarget(
        config.projectEndpoint,
        `${label(service)} project endpoint`,
      );
      assert.equal(
        projectEndpoint.protocol,
        "https:",
        `${label(service)} project endpoint must use HTTPS`,
      );
    }

    if (typeof config.server === "string") {
      const server = parseCredentialFreeTarget(config.server, `${label(service)} MCP server`);
      assert.equal(
        server.protocol === "http:" || server.protocol === "https:",
        true,
        `${label(service)} MCP server must use HTTP or HTTPS`,
      );
      assert.equal(
        server.hostname === "127.0.0.1" || server.hostname === "localhost",
        true,
        `${label(service)} local MCP server must use a loopback host`,
      );
    }

    const repeatKey = `${service.blueprintId}:${service.serviceId}:${service.declaration.kind}`;
    const serialized = JSON.stringify(config);
    const previous = repeatedConfigs.get(repeatKey);
    if (previous !== undefined) {
      assert.equal(serialized, previous, `${label(service)} repeats conflicting provider configuration`);
    } else {
      repeatedConfigs.set(repeatKey, serialized);
    }
  }
});
