import type { Json, NativeServiceDeclaration } from "@gik-ai/kernel";
import {
	serviceConfig,
	UnsatisfiedServiceDependencyError,
	type ServiceAdapter,
	type ServiceAdapterContext,
	type ServiceAgentTool,
	type ServiceAgentToolExecutionContext,
	type ServiceRequest,
	type ServiceKindFactory,
	type ServiceKindManifest,
} from "@gik-ai/controlface/services";
import { executeAgentFunctionCall, type AgentTool } from "@gik-ai/agent-lifecycle-exp";
import { createFoundryProxy, FoundryProxyError, type FoundryChatResponseSchema } from "./foundry-proxy";
import manifestJson from "./manifest.json";
import { parseAgentJsonReply } from "../agent-json-response";
import {
	closeAgentResponseWorkspace,
	openAgentResponseWorkspace,
	parseAgentResponseWorkspaceSpec,
	readAgentResponseProposal,
} from "../agent-response-workspace";

const manifest = manifestJson as ServiceKindManifest;

function record(value: Json | undefined): Record<string, Json> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, Json>;
}

function acceptedCapabilityIds(input: Record<string, Json>): string[] | undefined {
	if (!Object.prototype.hasOwnProperty.call(input, "acceptedCapabilities")) return undefined;
	if (!Array.isArray(input.acceptedCapabilities)) return [];
	return [...new Set(input.acceptedCapabilities.filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	))];
}

export function scopeDescribeArgs(args: unknown, acceptedCapabilities: readonly string[] | undefined): unknown {
	if (acceptedCapabilities === undefined || !args || typeof args !== "object" || Array.isArray(args)) return args;
	const input = args as Record<string, unknown>;
	if (input.kind !== "catalog-capabilities" && input.kind !== "multiple-capabilities") return args;
	if (input.capabilities !== undefined && !Array.isArray(input.capabilities)) return args;
	const accepted = new Set(acceptedCapabilities);
	const requested = Array.isArray(input.capabilities)
		? input.capabilities.filter((value): value is string => typeof value === "string")
		: [];
	const scoped = requested.filter((capability) => accepted.has(capability));
	return {
		...input,
		capabilities: requested.length > 0 ? [...new Set(scoped)] : [...acceptedCapabilities],
	};
}

function emptyDescribeSelection(args: unknown): boolean {
	if (!args || typeof args !== "object" || Array.isArray(args)) return false;
	const input = args as Record<string, unknown>;
	return (input.kind === "catalog-capabilities" || input.kind === "multiple-capabilities")
		&& Array.isArray(input.capabilities)
		&& input.capabilities.length === 0;
}

export function filterDescribeResult(
	value: unknown,
	acceptedCapabilities: readonly string[] | undefined,
): unknown {
	if (acceptedCapabilities === undefined || !value || typeof value !== "object" || Array.isArray(value)) return value;
	const result = value as Record<string, unknown>;
	if (!result.capabilities || typeof result.capabilities !== "object" || Array.isArray(result.capabilities)) return value;
	const accepted = new Set(acceptedCapabilities);
	return {
		...result,
		capabilities: Object.fromEntries(
			Object.entries(result.capabilities).filter(([id]) => accepted.has(id)),
		),
	};
}

export function selectAgentTools(
	tools: readonly ServiceAgentTool[],
	allowedTools: readonly string[] | undefined,
): readonly ServiceAgentTool[] {
	if (allowedTools === undefined) return tools;
	const allowed = new Set(allowedTools);
	return tools.filter(({ name }) => allowed.has(name));
}

export function createRequestAgentTools(
	tools: readonly ServiceAgentTool[],
	input: Record<string, Json>,
	context: ServiceAgentToolExecutionContext,
): readonly AgentTool[] {
	const acceptedCapabilities = acceptedCapabilityIds(input);
	return tools.map((tool) => ({
		...tool,
		handler: async (args: unknown) => {
			if (tool.name !== "describe") return tool.handler(args, context);
			const scopedArgs = scopeDescribeArgs(args, acceptedCapabilities);
			if (acceptedCapabilities !== undefined && emptyDescribeSelection(scopedArgs)) {
				return { capabilities: {} };
			}
			return filterDescribeResult(
				await tool.handler(scopedArgs, context),
				acceptedCapabilities,
			);
		},
	}));
}

function requestedMaxOutputTokens(input: Record<string, Json>, configuredCap: number | undefined): number | undefined {
	const requested = typeof input.maxOutputTokens === "number" ? input.maxOutputTokens : undefined;
	if (configuredCap === undefined) return requested;
	return requested === undefined ? configuredCap : Math.min(requested, configuredCap);
}

/** Accepts an explicit responseSchema passed by the caller through `request.input`. Useful when
 * one binding/operation (e.g. a generic "chat" operation shared across several logical
 * sub-operations) needs a different Structured Outputs schema per call rather than one fixed
 * schema per declared operation. */
function inputResponseSchema(input: Record<string, Json>): FoundryChatResponseSchema | undefined {
	const candidate = input.responseSchema;
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
	const { name, schema, strict } = candidate as Record<string, Json>;
	if (typeof name !== "string" || !schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
	return { name, schema: schema as Record<string, unknown>, strict: strict !== false };
}

function declaredResponseSchema(
	request: ServiceRequest,
	context: ServiceAdapterContext,
): FoundryChatResponseSchema | undefined {
	const validator = context.responseValidators?.find((rule) =>
		"kind" in rule
		&& rule.kind === "ajv-schema"
		&& rule.code === "provider-structured-output"
		&& rule.level !== "warning"
	);
	if (!validator || !("kind" in validator) || validator.kind !== "ajv-schema") return undefined;
	const schema = validator.schema;
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
	const name = `${request.capabilityId || request.operation}_response`
		.replace(/[^a-zA-Z0-9_-]/g, "_")
		.slice(0, 64);
	return { name, schema: schema as Record<string, unknown>, strict: true };
}

export function instructionsWithGuardrailCorrection(
	instructions: string | undefined,
	eventPayload: Record<string, Json> | undefined,
): string | undefined {
	const correction = record(eventPayload?.guardrailCorrection);
	const issues = Array.isArray(correction.issues)
		? correction.issues
			.map((issue) => record(issue).detail)
			.filter((detail): detail is string => typeof detail === "string" && detail.length > 0)
		: [];
	if (issues.length === 0) return instructions;
	const correctionPrompt = [
		"The previous response failed validation. Return a corrected response that satisfies every requirement:",
		...issues.map((issue) => `- ${issue}`),
	].join("\n");
	return instructions ? `${instructions}\n\n${correctionPrompt}` : correctionPrompt;
}

export function parseFoundryJsonReply(reply: string): Json {
	return parseAgentJsonReply("Foundry agent", reply);
}

export function createFoundryAgentKind(fetch?: typeof globalThis.fetch): ServiceKindFactory {
	return {
	manifest,
	validate: (declaration, context) => {
		if (!context.resolveCredential) {
			return { ok: false, errors: ["foundry-agent requires a host credential resolver"] };
		}
		const config = serviceConfig(declaration);
		try {
			const endpoint = new URL(String(config.endpoint));
			if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") {
				return { ok: false, errors: ["foundry-agent endpoint must use HTTPS"] };
			}
			if (!context.authorizeEndpoint) {
				return { ok: false, errors: [`foundry-agent endpoint '${endpoint.origin}' is not authorized by the host`] };
			}
			const authorized = context.authorizeEndpoint(manifest.id, endpoint);
			if (authorized instanceof Promise) {
				return authorized.then((allowed) => allowed
					? { ok: true }
					: { ok: false, errors: [`foundry-agent endpoint '${endpoint.origin}' is not authorized by the host`] });
			}
			if (!authorized) {
				return { ok: false, errors: [`foundry-agent endpoint '${endpoint.origin}' is not authorized by the host`] };
			}
		} catch {
			return { ok: false, errors: ["foundry-agent requires a valid endpoint"] };
		}
		return { ok: true };
	},
	create: (declaration: NativeServiceDeclaration, context): ServiceAdapter => {
		const config = serviceConfig(declaration);
		const endpoint = String(config.endpoint);
		const credentialRef = String(config.credentialRef);
		const configuredAgent = typeof config.agent === "string" ? config.agent : "";
		const configuredMaxOutputTokens = typeof config.maxOutputTokens === "number"
			? config.maxOutputTokens
			: undefined;
		const configuredAgentTools = Array.isArray(config.agentTools)
			? config.agentTools.filter((value): value is string => typeof value === "string")
			: undefined;
		const responseMode = config.responseMode === "json" ? "json" : "text";
		const operations = [...new Set(Object.values(declaration.operations).map(({ operation }) => operation))];
		const resolveAccessKey = async () => {
			try {
				return String(await context.resolveCredential!(credentialRef));
			} catch (error) {
				throw new UnsatisfiedServiceDependencyError(
					"Foundry access is required",
					{ kind: "credential", ref: credentialRef },
					{ cause: error },
				);
			}
		};
		const client = async () => createFoundryProxy({
			baseUrl: endpoint,
			key: await resolveAccessKey(),
			fetch,
		});
		const providerId = `foundry-agent:${context.identity?.serviceId ?? "anonymous"}`;
		return {
			provider: { id: providerId, version: manifest.version, title: manifest.title },
			discover: async () => ({
				provider: { id: providerId, version: manifest.version, title: manifest.title },
				revision: manifest.version,
				discoveredAt: new Date().toISOString(),
				capabilities: operations.map((operation) => ({
					id: operation,
					operation,
					version: declaration.version,
					inputSchema: {},
					assurance: "declared-and-locally-validated",
					supports: { validate: true },
				})),
			}),
			validate: (request) => operations.includes(request.operation)
				? { ok: true }
				: { ok: false, errors: [`Operation '${request.operation}' is not declared`] },
			probe: async () => {
				const agentName = configuredAgent;
				if (!agentName) return { ok: true, detail: { note: "Agent selected per request" } as Record<string, Json> };
				await (await client()).ping(agentName);
				return { ok: true, detail: { agentName } as Record<string, Json> };
			},
			execute: async (request, adapterContext) => {
				const input = record(request.input);
				const responseWorkspace = parseAgentResponseWorkspaceSpec(input.authoringWorkspace);
				if (responseWorkspace) openAgentResponseWorkspace(request.id, responseWorkspace);
				try {
					if (request.operation === "check-access") {
						await (await client()).checkAccess();
						return { output: { ok: true } };
					}
					if (request.operation === "discover") {
						return { output: await (await client()).listAgents() };
					}
					if (request.operation !== "chat") throw new Error(`Unsupported foundry-agent operation '${request.operation}'`);
					const agentName = configuredAgent || String(input.agentName ?? "");
					if (!agentName) throw new Error("foundry-agent requires config.agent or input.agentName");
					const responseSchema = inputResponseSchema(input)
						?? (responseMode === "json" ? undefined : declaredResponseSchema(request, adapterContext));
					const availableTools = selectAgentTools(adapterContext.agentTools ?? [], configuredAgentTools);
					if (configuredAgentTools !== undefined) {
						const availableNames = new Set(availableTools.map(({ name }) => name));
						const unavailable = configuredAgentTools.filter((name) => !availableNames.has(name));
						if (unavailable.length > 0) {
							throw new Error(`foundry-agent config.agentTools contains unavailable tool(s): ${unavailable.join(", ")}`);
						}
					}
					const tools = createRequestAgentTools(availableTools, input, {
						requestId: request.id,
						service: request.service,
						operation: request.operation,
						providerId: request.providerId,
						capabilityId: request.capabilityId,
						actorId: request.actorId,
						correlationId: request.correlationId,
						idempotencyKey: request.idempotencyKey,
						deadline: request.deadline,
						target: request.target,
						blueprintId: request.blueprintId,
						blueprintRevision: request.blueprintRevision,
						serviceRef: request.serviceRef,
						signal: adapterContext.signal,
					});
					const instructions = instructionsWithGuardrailCorrection(
						typeof input.instructions === "string" ? input.instructions : undefined,
						request.eventPayload,
					);
					const maxOutputTokens = requestedMaxOutputTokens(input, configuredMaxOutputTokens);
					const allowedTools = tools.map(({ name }) => name);
					const foundry = await client();
					let response = await foundry.chat({
							message: String(input.message ?? ""),
							agentName,
							conversationId: typeof input.conversationId === "string" ? input.conversationId : undefined,
							instructions,
							maxOutputTokens,
							responseSchema,
							allowedTools,
						});
					let inProgressProposal = false;
					for (let turn = 0; response.toolCalls.length > 0; turn += 1) {
						if (turn >= 8) throw new Error("Foundry agent exceeded the lifecycle tool turn limit");
						if (tools.length === 0) throw new Error("Foundry agent requested lifecycle tools that this host did not provide");
						const outputs = await Promise.all(response.toolCalls.map(async (call) => {
							try {
								const output = await executeAgentFunctionCall(tools, call, { requestId: request.id });
								if (!responseWorkspace && call.name.endsWith("_set_in_progress_proposal")) {
									inProgressProposal = true;
								}
								return { callId: output.call_id, output: output.output };
							} catch (error) {
								return {
									callId: call.callId,
									output: JSON.stringify({
										ok: false,
										error: error instanceof Error ? error.message : String(error),
									}),
								};
							}
						}));
						response = await foundry.chat({
							agentName,
							conversationId: response.conversationId,
							maxOutputTokens,
							responseSchema,
							allowedTools,
							toolOutputs: outputs,
						});
					}
					let structuredOutput: Json | undefined = responseWorkspace
						? readAgentResponseProposal(request.id) as unknown as Json | undefined
						: undefined;
					if (responseWorkspace && !structuredOutput) {
						throw new Error("Foundry agent completed without setting a validated response proposal");
					}
					if (!responseWorkspace && responseSchema) {
						try {
							structuredOutput = JSON.parse(response.reply) as Json;
						} catch {
							throw new Error("Foundry agent returned invalid structured JSON");
						}
					} else if (!responseWorkspace && responseMode === "json") {
						structuredOutput = parseFoundryJsonReply(response.reply);
					}
					return {
						output: structuredOutput ?? response as unknown as Json,
						detail: structuredOutput === undefined && !inProgressProposal
							? undefined
							: {
								responseId: response.responseId,
								conversationId: response.conversationId,
								...(inProgressProposal ? { inProgressProposal: true } : {}),
							},
					};
				} catch (error) {
					if (error instanceof FoundryProxyError && (error.status === 401 || error.status === 403)) {
						await context.clearCredential?.(credentialRef);
						throw new UnsatisfiedServiceDependencyError(
							"Foundry access key was rejected",
							{ kind: "credential", ref: credentialRef },
							{ cause: error },
						);
					}
					throw error;
				} finally {
					if (responseWorkspace) closeAgentResponseWorkspace(request.id);
				}
			},
		};
	},
	};
}

export const foundryAgentKind = createFoundryAgentKind();
