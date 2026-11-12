# Portfolio Tracker New: Canonical Test Cases

Every end-to-end run starts with explicit external context:

```json
{
  "intelligence-model": "simple",
  "view": "desktop"
}
```

The test matrix covers `simple|mock|semantic` intelligence and `desktop|mobile`
presentation. Tests assert Blueprint behavior rather than generic host, lowering,
or external-context transport behavior.

## Cell contract

| Cell | Inputs | Outputs |
| --- | --- | --- |
| `portfolio-holdings` | none | `holdings` |
| `market-prices` | `holdings` | `stock-quotes` |
| `portfolio-value-cell` | `holdings`, `stock-quotes` | `portfolio-value` |
| `portfolio-intelligence` | `portfolio-value` | none |
| `portfolio-intelligence-as-of` | none | none |
| `board` | none | none |

## Durable purpose and context

The existing `portfolio-intelligence` Cell owns `dpp`; it is not a new Cell
kind. Its manifest retains the portfolio-value participant's full durable
charter and evolving working model. Expressions read the complete immutable
manifest as `dpp.manifest`, and completed ordinary/context source values as
`fetched_sources.<sourceId>` (never the old `sources` expression root).
The `sources` configuration arrays and service source configuration are unchanged.

The manifest's `context-store.query` and `context-store.ingest` values identify
the actor's context sources. They resolve the `context-store.query/v1` and
`context-store.ingest/v1` contracts on the native `context-store` service with
`config.storeRef: portfolio-context`. Context sources coexist with the actor's
ordinary intelligence sources; supporting saved-report Cells remain separate.

The host explicitly authorizes this store and routes it through the service-kind
`execute` path to the Blueprint/instance's durable KV storage. There is no
in-memory or implicit provider fallback. Records are additionally isolated by
stable `portfolio.id` scope, not serialized changing valuations. A snapshot and
refresh generation identify each query and observation; retries preserve the
first stored observation. The query selects at most ten prior observations in
descending observation-time order. Unsupported query selectors fail explicitly.
The host hashes storage keys while preserving original record IDs, so snapshot
identifiers remain usable with filesystem-backed as well as browser storage.

All intelligence variants receive the full purpose manifest and selected
historical/saved-report evidence alongside current facts, retaining existing
report response formats. Requests wait for a matching query response, so a
valuation change cannot consume stale context. Ingestion records identified
portfolio evidence with a timestamp fixed by query completion, not a ticking
source-input clock. It does not grant trading authority. Removing the actor
leaves holdings, prices, and valuation responsibilities intact.

Query, ingestion, and report sources explicitly stop after completing the current
snapshot/refresh key. Internal fetched report results wrap the unchanged report
as `{requestKey, report}`; the key comes from immutable launch `inputs` in the
source output transform. Compute and output gates unwrap only a matching report
for saving, preventing stale report completion from being cached under a new
snapshot. A stored acknowledgment cannot trigger another ingestion/query cycle.

Focused coverage: `src/scenarios/portfolio-dpp.test.ts` and
`src/service-kinds/context-store/runtime.test.ts`.

## Behavioral cases

1. Initial holdings trigger quote retrieval, exact position/value calculation,
   intelligence generation, and board presentation.
2. Adding a holding refreshes the exact ticker set and recomputes value and
   intelligence.
3. Removing a holding removes stale quotes and positions from downstream output.
4. Rapid edits settle to the final holdings, quotes, value, and intelligence.
5. Position values, cost basis, gain/loss, and totals agree to two decimals.
6. `intelligence-model: simple` uses the existing Foundry
   `Portfolio-Intelligence-Agent` configuration.
7. `intelligence-model: mock` uses the deterministic test-service path to return
   predictable semantic-shaped intelligence for the current portfolio values.
8. `intelligence-model: semantic` uses one logical
   `portfolio-semantic-intelligence/v1` service contract and the
   `Portfolio-Semantic-Intelligence-Agent`. Provider lowering replaces that same
   service declaration with its Foundry or Copilot implementation. The request
   selects `simple-markdown` or `rich-components` through `presentationMode`;
   both modes use the same operation and agent-facing capability tools.
   The host stamps report generation time and renders it above the nested report.
9. `view: desktop` presents portfolio value as total value, holdings-value pie
   chart, and exact positions table in the desktop board arrangement.
10. `view: mobile` presents the same portfolio total and holdings-value pie chart
   without the positions table in the mobile board arrangement.
11. All six explicit context combinations preserve domain results while selecting
    the requested intelligence source and board arrangement.

The Node-host HTTP and Blueprint behavior tests use `mock` so they remain predictable
and credential-free. Selection tests verify the two Foundry configurations without
invoking them. Browser-host tests exercise editing, mock intelligence, and both
recipe-selected portfolio-value presentations through visible controls. Existing
portfolio market-price and Foundry intelligence services are reused.