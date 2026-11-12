# Finbook domain

Private CommonJS module boundary used by the [Finbook server](../README.md).
The local `package.json` selects CommonJS for domain modules; this is not an
independently installable or published npm package.

- `lib/` owns finance contracts, calculations, report generation, and storage
  access used by the server's handler.
- `DB/` contains checked-in seed material; mutable SQLite state is not a
  documentation or source artifact.
- `scripts/` owns domain validation/tests and MCP manifest generation.
- [mcp-executable-manifest.json](mcp-executable-manifest.json) is the generated
  tool catalog consumed by the server.

Run domain checks through the parent server's `check` script rather than
maintaining a separate install/test sequence here. Hosted persistence must
preserve the [storage contract](../storage-contract.md).
