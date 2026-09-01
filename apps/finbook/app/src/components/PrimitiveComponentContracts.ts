import type { CapabilityDescriptor } from "@gik-ai/kernel";

const formPropsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fields: { type: "object" },
    schema: { type: "object" },
    value: { type: "object" },
    data: { type: "object" },
    validationContext: { type: "object" },
    saveLabel: { type: "string" },
    discardLabel: { type: "string" },
    successLabel: { type: "string" },
    savingLabel: { type: "string" },
    saving: { type: "boolean" },
    saveError: { type: "string" },
    initiallyDirty: { type: "boolean" },
    readOnly: { type: "boolean" },
    layout: {
      type: "object",
      additionalProperties: false,
      properties: {
        slots: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "slot"],
            properties: {
              key: { type: "string", minLength: 1 },
              slot: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
    className: { type: "string" },
    style: {
      type: "object",
      additionalProperties: { type: ["string", "number"] },
    },
  },
} as const;

export const finbookPrimitiveComponentCapabilities: Record<string, CapabilityDescriptor> = {
  form: {
    propsSchema: formPropsSchema,
    dataProp: "value",
    emits: ["save"],
  },
};
