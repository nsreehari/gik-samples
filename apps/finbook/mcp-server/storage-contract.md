# Finbook persistence boundary

The Finbook MCP contract and domain reports are independent of physical
persistence. The included adapter stores committed state and journal entries in
SQLite for local development.

A hosted adapter must preserve these operations atomically:

- initialize storage from an explicit seed;
- load and replace committed Finbook state;
- list, append, replace, and discard journal entries;
- execute a commit using optimistic concurrency or a transaction;
- preserve typed financial columns and JSON-compatible extension values.

Cloud deployments should use a shared relational service such as PostgreSQL or
Azure SQL. A function instance's local filesystem is not durable application
storage. Hosted adapters must keep the public Finbook MCP envelopes and report
shapes unchanged.
