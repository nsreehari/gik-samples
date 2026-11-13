# Portfolio DPP intake

The Portfolio sample's existing purpose-bearing intelligence Cell also accepts
one CSV, JSON or plain-text file (up to 100 KB) and an optional text note. A note
alone works too. Select the AI provider in the sample launch settings, then use
**Update portfolio** in the holdings area.
Intake requires a configured AI connection even when intelligence reports use
the mock model. Notes are limited to 4,000 characters.
Foundry intake selects the dedicated `Portfolio-Intake-Agent`. The existing
`Portfolio-Intelligence-Agent` remains responsible for reports; its response
schema is not compatible with holdings reconciliation.

## Foundry setup

The product-owned [intake agent plan](./foundry-intake-agent.json) configures the
named prompt agent, its closed JSON response schema and no tools. Provision it
with the existing `azure-function-proxy` tooling after `az login`:

```powershell
npm run agent:provision -- --plan <absolute-path-to-foundry-intake-agent.json>
```

Run that command from the proxy repository with Node.js 24 and the intended
`FOUNDRY_ENDPOINT` configured. The sample deployment uses the `gpt-5.4` model
deployment. Agent provisioning requires project permissions; normal browser
use still requires the host-managed Foundry access credential.

The proxy deliberately admits a requested response schema only when it
matches the named agent's configured schema. Keep the plan and the native
intake request schema aligned; the real-adapter regression exercises that
admission boundary. Do not relax the proxy check or replace the report agent's
schema to enable intake.

## Trying intake

For example, upload:

```csv
ticker,quantity,costBasis
AAPL,5,95
```

Or submit: `Set AAPL to 5 shares with a per-share cost basis of 95.`

The AI interprets the submission against the current sample holdings and the
DPP's charter and scoped context. Typed response validation precedes a correlated
Blueprint event that merges only the returned positions. Unmentioned holdings
remain unchanged. Ambiguous submissions and invalid responses show an error and
leave the draft intact. Successful processing clears the draft and shows a short
summary; a conflicting manual holdings edit requires resubmission.
The form keeps submission available after success, including another file-only
submission. Its note is read-only while the captured submission is processing.

This reuses `primitive:file-input` and `primitive:form`, the existing Foundry or
Copilot service adapters, and ordinary declarative events and settlements. The
DPP's context bindings retain the accepted changes, note, filename and summary;
raw uploaded text is not retained in the context store. Inputs are sent to the
configured AI connection only when submitted. No brokerage transactions occur.

`gik-service-providers/gmail` and `/scheduler` are not needed for a user-submitted
file/note path, so the sample does not import them just to demonstrate a package.
The existing context-store contract is the backend seam; a separately configured
provider can implement it without moving portfolio decisions into the host.

PDF/image extraction, OCR, strategy adoption and monitoring are deliberately
outside this first increment. This is a sample, not a financial-record system:
AI interpretation can be incorrect, and a valid response is not proof that its
interpretation is correct. The sample's host still owns credentials, endpoint
admission and execution authority.
