import assert from "node:assert/strict";
import { test } from "vitest";

import { localDevelopmentEndpointPolicy } from "../../reference-app-host/policies";

test("local endpoint policy permits HTTPS and loopback HTTP only", async () => {
  assert.equal(
    await localDevelopmentEndpointPolicy.authorizeEndpoint(
      "mcp",
      new URL("http://127.0.0.1:7811/mcp"),
    ),
    true,
  );
  assert.equal(
    await localDevelopmentEndpointPolicy.authorizeEndpoint(
      "mcp",
      new URL("https://finbook.example/mcp"),
    ),
    true,
  );
  assert.equal(
    await localDevelopmentEndpointPolicy.authorizeEndpoint(
      "mcp",
      new URL("http://finbook.example/mcp"),
    ),
    false,
  );
  assert.equal(
    await localDevelopmentEndpointPolicy.authorizeEndpoint(
      "other",
      new URL("https://finbook.example/service"),
    ),
    false,
  );
});
