export const agentResponseFragmentInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fragmentJson: { type: "string", minLength: 2 },
  },
  required: ["fragmentJson"],
} as const;

export const agentResponseToolContracts = {
  compose_response_validate: {
    description: "Compose an authored response fragment into the trusted scaffold and validate the complete candidate.",
    inputSchema: agentResponseFragmentInputSchema,
  },
  compose_response_simulate: {
    description: "Compose, validate, and materialize an authored response fragment without storing it.",
    inputSchema: agentResponseFragmentInputSchema,
  },
  compose_response_read_in_progress_proposal: {
    description: "Read the complete scaffolded response proposal currently stored for this request.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  compose_response_set_in_progress_proposal: {
    description: "Compose an authored response fragment into the trusted scaffold, validate and materialize the complete candidate, then store it as the request-scoped proposal.",
    inputSchema: agentResponseFragmentInputSchema,
  },
} as const;
