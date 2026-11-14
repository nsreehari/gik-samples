import assert from "node:assert/strict";
import { test } from "vitest";
import type {
	ServiceAgentTool,
	ServiceAgentToolExecutionContext,
} from "gik-controlface/services";
import { ServiceKindRegistry, UnsatisfiedServiceDependencyError, type ServiceRequest } from "gik-controlface/services";
import type { Json, NativeServiceDeclaration } from "gik-kernel";
import type { AgentTool } from "gik-agent-lifecycle-exp";

import {
	createRequestAgentTools,
	createFoundryServiceKind,
	filterDescribeResult,
	instructionsWithGuardrailCorrection,
	selectAgentTools,
	scopeDescribeArgs,
} from "../src/foundry";

const foundryDeclaration: NativeServiceDeclaration = {
	kind: "foundry-agent", version: "1",
	config: { endpoint: "https://foundry.example", credentialRef: "foundry/key", agent: "report", responseMode: "json" },
	operations: { report: { operation: "chat", contract: "report/v1" } },
};
const foundryRequest = (input: Json): ServiceRequest => ({
	id: "request-1", service: "foundry", operation: "chat", input,
	providerId: "foundry-agent", capabilityId: "report/v1", createdAt: "now",
});
const foundryRegistry = (credential: unknown = "test-key") => new ServiceKindRegistry({
	hostCapabilities: ["foundry-executor", "credential-resolver"],
	resolveCredential: async () => credential,
	authorizeEndpoint: () => true,
});

test("Foundry provider continues lifecycle tool calls through host handlers", async () => {
	const requests: Record<string, Json>[] = [];
	const registry = foundryRegistry();
	registry.register(createFoundryServiceKind({ fetch: async (_url, init) => {
		requests.push(JSON.parse(String(init?.body)) as Record<string, Json>);
		return Response.json({
			conversationId: "conversation", responseId: `response-${requests.length}`,
			reply: requests.length === 1 ? "" : '{"markdown":"Host tools completed."}',
			toolCalls: requests.length === 1 ? [{ callId: "call", name: "describe", arguments: "{}" }] : [],
		});
	} }));
	const adapter = await registry.materialize({ blueprintId: "test", blueprintRevision: "1", serviceId: "foundry" }, foundryDeclaration);
	const result = await adapter.execute(foundryRequest({ message: "Report" }), {
		agentTools: [{
			name: "describe", description: "Describe", inputSchema: { type: "object" }, lifecycle: "agent",
			handler: (_args, context) => {
				assert.equal(context.requestId, "request-1");
				assert.equal(context.service, "foundry");
				return { ok: true };
			},
		}],
	});
	assert.deepEqual(result.output, { markdown: "Host tools completed." });
	assert.equal(requests.length, 2);
	assert.deepEqual(requests[0].allowedTools, ["describe"]);
	assert.deepEqual(requests[1].allowedTools, ["describe"]);
	assert.deepEqual(requests[1].toolOutputs, [{ callId: "call", output: '{"ok":true}' }]);
});

test.each(["proposal", "missing-proposal", "transport-error"])("Foundry host response workspace closes after %s", async (outcome) => {
	const spec = { scaffold: {}, slots: [] };
	const expected = { accepted: true };
	let proposal: unknown;
	let closed = 0;
	const registry = foundryRegistry();
	registry.register(createFoundryServiceKind({
		openResponseWorkspace: (requestId, workspaceSpec) => {
			assert.equal(requestId, "request-1");
			assert.deepEqual(workspaceSpec, spec);
			return { readProposal: () => proposal, close: () => { closed += 1; } };
		},
		fetch: async (_url, init) => {
			assert.deepEqual(JSON.parse(String(init?.body)).allowedTools, ["publish"]);
			if (outcome === "transport-error") throw new Error("Transport unavailable");
			return Response.json({
				conversationId: "conversation", responseId: "response", reply: "{}",
				toolCalls: outcome === "proposal" ? [{ callId: "call", name: "publish", arguments: "{}" }] : [],
			});
		},
	}));
	const adapter = await registry.materialize({ blueprintId: "test", blueprintRevision: "1", serviceId: "foundry" }, foundryDeclaration);
	const execute = () => adapter.execute(foundryRequest({ message: "Compose", authoringWorkspace: spec }), {
		agentTools: [{
			name: "publish", description: "Publish", inputSchema: { type: "object" }, lifecycle: "agent",
			handler: () => { proposal = expected; return { stored: true }; },
		}],
	});
	if (outcome === "proposal") assert.deepEqual((await execute()).output, expected);
	else await assert.rejects(execute, outcome === "transport-error" ? /Transport unavailable/ : /without setting a validated response proposal/);
	assert.equal(closed, 1);
});

test("Foundry authoring refuses a missing host workspace without making a request", async () => {
	const registry = foundryRegistry();
	registry.register(createFoundryServiceKind({ fetch: async () => assert.fail("No request without a host workspace") }));
	const adapter = await registry.materialize({ blueprintId: "test", blueprintRevision: "1", serviceId: "foundry" }, foundryDeclaration);
	await assert.rejects(() => adapter.execute(foundryRequest({ message: "Compose", authoringWorkspace: {} }), {}), /requires a host response workspace/);
});

test.each([null, {}, 42])("Foundry rejects an invalid resolved credential: %j", async (credential) => {
	const registry = foundryRegistry(credential);
	registry.register(createFoundryServiceKind({ fetch: async () => assert.fail("No request with an invalid credential") }));
	const adapter = await registry.materialize({ blueprintId: "test", blueprintRevision: "1", serviceId: "foundry" }, foundryDeclaration);
	await assert.rejects(() => adapter.execute(foundryRequest({ message: "Report" }), {}), (error) => {
		assert.ok(error instanceof UnsatisfiedServiceDependencyError);
		assert.equal(error.message, "Foundry access is required");
		return true;
	});
});

test("Foundry correction retries include response validation issues", () => {
	const instructions = instructionsWithGuardrailCorrection(
		"Return only the requested report fields.",
		{
			guardrailCorrection: {
				issues: [
					{ detail: "markdown must be a non-empty string" },
					{ detail: "additional properties are not allowed" },
				],
			},
		},
	);

	assert.match(instructions ?? "", /Return only the requested report fields/);
	assert.match(instructions ?? "", /markdown must be a non-empty string/);
	assert.match(instructions ?? "", /additional properties are not allowed/);
});

test("Foundry describe arguments stay inside the request's accepted capability set", () => {
	const accepted = ["semantic:narrative", "security:attack-path"];
	assert.deepEqual(scopeDescribeArgs({
		kind: "catalog-capabilities",
		capabilities: [],
	}, accepted), {
		kind: "catalog-capabilities",
		capabilities: accepted,
	});
	assert.deepEqual(scopeDescribeArgs({
		kind: "multiple-capabilities",
		capabilities: ["primitive:markdown", "security:attack-path"],
	}, accepted), {
		kind: "multiple-capabilities",
		capabilities: ["security:attack-path"],
	});
	assert.deepEqual(scopeDescribeArgs({
		kind: "multiple-capabilities",
		capabilities: ["primitive:markdown"],
	}, accepted), {
		kind: "multiple-capabilities",
		capabilities: [],
	});
	assert.deepEqual(scopeDescribeArgs({
		kind: "catalog-capabilities",
		capabilities: [],
	}, undefined), {
		kind: "catalog-capabilities",
		capabilities: [],
	});
	assert.deepEqual(filterDescribeResult({
		capabilities: {
			"semantic:narrative": { for: "Narrative" },
			"primitive:markdown": { for: "Markdown" },
		},
	}, accepted), {
		capabilities: {
			"semantic:narrative": { for: "Narrative" },
		},
	});
});

test("Foundry service tool allowlists default to all tools and otherwise filter the manifest", () => {
	const tools = ["describe", "compose_response_validate", "compose_response_set_in_progress_proposal"]
		.map((name): ServiceAgentTool => ({
			name,
			description: name,
			inputSchema: {},
			lifecycle: "agent",
			handler: () => null,
		}));
	assert.equal(selectAgentTools(tools, undefined), tools);
	assert.deepEqual(
		selectAgentTools(tools, ["describe", "compose_response_set_in_progress_proposal"])
			.map(({ name }) => name),
		["describe", "compose_response_set_in_progress_proposal"],
	);
});

test("Foundry request tools forward request context and scope describe calls", async () => {
	const executionContext: ServiceAgentToolExecutionContext = {
		requestId: "request-1",
		service: "incident-report-fixed-presentation",
		operation: "chat",
		providerId: "foundry-agent:test",
		capabilityId: "authorReportBlueprint",
	};
	let receivedArgs: unknown;
	let receivedContext: ServiceAgentToolExecutionContext | undefined;
	const describe: ServiceAgentTool = {
		name: "describe",
		description: "Describe capabilities.",
		inputSchema: {},
		lifecycle: "agent",
		handler: (args, context) => {
			receivedArgs = args;
			receivedContext = context;
			return { ok: true };
		},
	};
	const [tool] = createRequestAgentTools([describe], {
		acceptedCapabilities: ["semantic:narrative"],
	}, executionContext);

	await tool.handler({
		kind: "multiple-capabilities",
		capabilities: ["semantic:narrative", "primitive:markdown"],
	});

	assert.deepEqual(receivedArgs, {
		kind: "multiple-capabilities",
		capabilities: ["semantic:narrative"],
	});
	assert.equal(receivedContext, executionContext);
});

test("Foundry describe preserves the full catalog only when acceptedCapabilities is absent", async () => {
	const describe: ServiceAgentTool = {
		name: "describe",
		description: "Describe capabilities.",
		inputSchema: {},
		lifecycle: "agent",
		handler: () => ({
			capabilities: {
				"semantic:narrative": {},
				"primitive:markdown": {},
			},
		}),
	};
	const context: ServiceAgentToolExecutionContext = {
		requestId: "request-1",
		service: "service",
		operation: "chat",
		providerId: "provider",
		capabilityId: "capability",
	};
	const [unrestricted] = createRequestAgentTools([describe], {}, context);
	const [empty] = createRequestAgentTools([describe], { acceptedCapabilities: [] }, context);

	assert.deepEqual(await unrestricted.handler({
		kind: "catalog-capabilities",
		capabilities: [],
	}), {
		capabilities: {
			"semantic:narrative": {},
			"primitive:markdown": {},
		},
	});
	assert.deepEqual(await empty.handler({
		kind: "catalog-capabilities",
		capabilities: [],
	}), { capabilities: {} });
});

test("Foundry request tools prefer a scoped describe tool when the host provides one", async () => {
	let scopedTo: readonly string[] | undefined;
	let receivedArgs: unknown;
	const describe: ServiceAgentTool & {
		scopeToCapabilities?: (acceptedCapabilities: readonly string[] | undefined) => Promise<AgentTool>;
	} = {
		name: "describe",
		description: "Describe capabilities.",
		inputSchema: {},
		lifecycle: "agent",
		handler: () => ({ capabilities: { "primitive:markdown": {} } }),
		scopeToCapabilities: async (acceptedCapabilities) => {
			scopedTo = acceptedCapabilities;
			return {
				name: "describe",
				description: "Describe capabilities.",
				inputSchema: {},
				lifecycle: "agent",
				handler: async (args) => {
					receivedArgs = args;
					return { capabilities: { "semantic:narrative": {} } };
				},
			};
		},
	};
	const context: ServiceAgentToolExecutionContext = {
		requestId: "request-1",
		service: "service",
		operation: "chat",
		providerId: "provider",
		capabilityId: "capability",
	};
	const [tool] = createRequestAgentTools([describe], {
		acceptedCapabilities: ["semantic:narrative"],
	}, context);

	const result = await tool.handler({
		kind: "catalog-capabilities",
		capabilities: [],
	});

	assert.deepEqual(scopedTo, ["semantic:narrative"]);
	assert.deepEqual(receivedArgs, {
		kind: "catalog-capabilities",
		capabilities: ["semantic:narrative"],
	});
	assert.deepEqual(result, {
		capabilities: {
			"semantic:narrative": {},
		},
	});
});
