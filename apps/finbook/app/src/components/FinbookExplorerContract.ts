import type { CapabilityDescriptor } from "@gik-ai/kernel";

export const finbookExplorerPropsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["result"],
  properties: {
    result: {
      type: "object",
      additionalProperties: false,
      required: ["title", "rows"],
      properties: {
        title: { type: "string", minLength: 1 },
        description: { type: "string" },
        rows: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    emptyMessage: { type: "string" },
    className: { type: "string" },
  },
} as const;

export const financeComponentCapabilities: Record<string, CapabilityDescriptor> = {
  "finbook-explorer": {
    propsSchema: finbookExplorerPropsSchema,
    dataProp: "result",
    emits: [],
  },
};
