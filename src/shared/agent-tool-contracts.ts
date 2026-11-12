import { capabilityDescribeInputSchema } from "gik-agent-lifecycle-exp";

import { agentResponseToolContracts } from "../service-kinds/agent-response-tool-contracts";

export const sampleAgentToolContracts = {
  describe: {
    description: "Discover projection capabilities or retrieve compact contracts for multiple shortlisted capabilities in one call.",
    inputSchema: capabilityDescribeInputSchema,
  },
  ...agentResponseToolContracts,
} as const;
