import assert from "node:assert/strict";
import { test } from "vitest";
import type {
	ServiceAgentTool,
	ServiceAgentToolExecutionContext,
} from "gik-controlface/services";

import {
	createRequestAgentTools,
	filterDescribeResult,
	instructionsWithGuardrailCorrection,
	selectAgentTools,
	scopeDescribeArgs,
} from "./index";

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
