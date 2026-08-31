import assert from "node:assert/strict";
import { test } from "vitest";

import { instructionsWithGuardrailCorrection } from "./index";

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
