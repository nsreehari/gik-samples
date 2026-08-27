import React from "react";
import {
  Button,
  Caption1,
  Field,
  Input,
  Subtitle1,
  Textarea,
  Title1,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { getSampleBlueprintCatalog } from "../../../bootstrap/catalog/blueprint-catalog";
import { ApplicationSwitcher } from "../ApplicationSwitcher";
import {
  ProvisioningCompanionClient,
  type ServerPlan,
} from "./companion-client";
import {
  defaultProvisioningProfile,
  generateProvisioningPlan,
  serverPlanInput,
  type AgentProvisioningPlan,
  type AgentProvisioningProfile,
} from "./provisioning";
import { createBrowserProvisioningProfileStore } from "./profile-storage";

const useStyles = makeStyles({
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXL,
    padding: `${tokens.spacingVerticalXXL} clamp(16px, 5vw, 64px)`,
  },
  header: { maxWidth: "78ch", display: "grid", gap: tokens.spacingVerticalS },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 0.8fr) minmax(320px, 1.2fr)",
    gap: tokens.spacingHorizontalXL,
    alignItems: "start",
    "@media (max-width: 800px)": { gridTemplateColumns: "1fr" },
  },
  panel: {
    display: "grid",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: tokens.spacingHorizontalM,
  },
  setupGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: tokens.spacingHorizontalL,
  },
  setupStep: {
    display: "grid",
    alignContent: "start",
    gap: tokens.spacingVerticalS,
  },
  setupList: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalXL,
    display: "grid",
    gap: tokens.spacingVerticalXS,
  },
  actions: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS },
  select: {
    minHeight: "32px",
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    padding: `0 ${tokens.spacingHorizontalS}`,
  },
  code: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    maxHeight: "28rem",
    overflow: "auto",
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
  },
  status: {
    padding: tokens.spacingHorizontalS,
    borderLeft: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    whiteSpace: "pre-wrap",
  },
  error: {
    padding: tokens.spacingHorizontalS,
    borderLeft: `${tokens.strokeWidthThick} solid ${tokens.colorPaletteRedBorder2}`,
    color: tokens.colorPaletteRedForeground1,
    whiteSpace: "pre-wrap",
  },
});

function profileFrom(
  current: AgentProvisioningProfile,
  patch: Partial<AgentProvisioningProfile>,
): AgentProvisioningProfile {
  return { ...current, ...patch };
}

export function AgentProvisioningPage({
  durableEnabled,
}: {
  durableEnabled: boolean;
}): React.ReactElement {
  const styles = useStyles();
  const catalog = getSampleBlueprintCatalog();
  const blueprints = React.useMemo(
    () => Object.values(catalog.entries).sort((left, right) =>
      left.payload.id.localeCompare(right.payload.id)),
    [catalog],
  );
  const [blueprintId, setBlueprintId] = React.useState(blueprints[0]?.payload.id ?? "");
  const blueprint = catalog.entries[blueprintId];
  const store = React.useMemo(
    () => createBrowserProvisioningProfileStore(durableEnabled),
    [durableEnabled],
  );
  const [profile, setProfile] = React.useState<AgentProvisioningProfile | null>(
    blueprint ? defaultProvisioningProfile(blueprint) : null,
  );
  const [plan, setPlan] = React.useState<AgentProvisioningPlan | null>(null);
  const [serverPlan, setServerPlan] = React.useState<ServerPlan | null>(null);
  const [port, setPort] = React.useState("7801");
  const [pairingCode, setPairingCode] = React.useState("");
  const [client, setClient] = React.useState<ProvisioningCompanionClient | null>(null);
  const [runPrompt, setRunPrompt] = React.useState("Inspect this workspace and summarize its purpose.");
  const [status, setStatus] = React.useState("Select a Blueprint and edit its user-owned provisioning profile.");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let active = true;
    setPlan(null);
    setServerPlan(null);
    if (!blueprint) return () => { active = false; };
    void store.read(blueprint.payload.id).then((stored) => {
      if (active) setProfile(stored ?? defaultProvisioningProfile(blueprint));
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [blueprint, store]);

  const act = async (label: string, action: () => Promise<void>) => {
    setError("");
    setStatus(label);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("Operation failed.");
    }
  };

  const saveAndGenerate = () => act("Saving profile and generating deterministic plan\u2026", async () => {
    if (!blueprint || !profile) throw new Error("Select a Blueprint first");
    const next = generateProvisioningPlan(blueprint, profile);
    await store.write(profile);
    setPlan(next);
    setServerPlan(null);
    setStatus("Profile saved. Local deterministic plan is ready to preview or download.");
  });

  const download = () => {
    if (!plan) return;
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(plan, null, 2)}\n`], {
      type: "application/json",
    }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${plan.profile.agentId}-${plan.provider}-plan.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const pair = () => act("Pairing with local companion\u2026", async () => {
    const next = new ProvisioningCompanionClient(port);
    const paired = await next.pair(pairingCode);
    const environment = await next.operation<{
      workspaceRoots: Array<{ id: string; root: string }>;
      copilot: { available: boolean };
      azureCli: { available: boolean };
      foundry: { configured: boolean };
    }>("environment", {});
    setClient(next);
    setPairingCode("");
    setStatus([
      `Paired with local companion until ${paired.expiresAt}. The bearer stays in memory.`,
      `Workspace roots: ${environment.workspaceRoots.map(({ id }) => id).join(", ") || "none"}`,
      `Copilot CLI: ${environment.copilot.available ? "available" : "unavailable"}`,
      `Azure CLI: ${environment.azureCli.available ? "available" : "unavailable"}`,
      `Foundry endpoint: ${environment.foundry.configured ? "configured" : "not configured"}`,
    ].join("\n"));
  });

  const serverOperation = async <T,>(name: string, input: unknown): Promise<T> => {
    if (!client) throw new Error("Pair with the local companion first");
    return client.operation<T>(name, input);
  };

  const previewServer = () => act("Creating protected server-side plan\u2026", async () => {
    if (!plan) throw new Error("Generate the local plan first");
    const next = await serverOperation<ServerPlan>(
      plan.provider === "copilot" ? "copilot_workspace_plan" : "foundry_plan",
      serverPlanInput(plan),
    );
    setServerPlan(next);
    setStatus(`Server plan ready. It expires at ${next.expiresAt}. Review all actions before applying.`);
  });

  const apply = () => act("Applying reviewed server plan\u2026", async () => {
    if (!plan || !serverPlan) throw new Error("Create a server-side plan first");
    const result = await serverOperation<Record<string, unknown>>(
      plan.provider === "copilot" ? "copilot_workspace_apply" : "foundry_apply",
      serverPlan,
    );
    setStatus(`Apply complete.\n${JSON.stringify(result, null, 2)}`);
  });

  const verify = () => act("Verifying provisioned agent\u2026", async () => {
    if (!plan || !serverPlan) throw new Error("Create a server-side plan first");
    const result = await serverOperation<Record<string, unknown>>(
      plan.provider === "copilot" ? "copilot_workspace_verify" : "foundry_verify",
      serverPlan,
    );
    setStatus(`Verification complete.\n${JSON.stringify(result, null, 2)}`);
  });

  const runCopilot = () => act("Running constrained Copilot smoke prompt\u2026", async () => {
    if (!profile) throw new Error("Select a profile first");
    const result = await serverOperation<{ stdout: string }>("copilot_cli_run", {
      workspaceRootId: profile.workspaceRootId,
      agent: profile.agentId,
      model: profile.model,
      message: runPrompt,
      timeoutMs: 60_000,
    });

    setStatus(`Copilot run complete.\n${result.stdout}`);
  });

  const runFoundry = () => act("Running Foundry smoke prompt\u2026", async () => {
    if (!profile || !serverPlan) throw new Error("Apply or verify a server-side plan first");
    const result = await serverOperation<{ reply: string; toolCalls: unknown[] }>("foundry_smoke", {
      ...serverPlan,
      agentId: profile.agentId,
      message: runPrompt,
    });
    setStatus(`Foundry run complete.\n${result.reply || JSON.stringify(result.toolCalls, null, 2)}`);
  });

  return (
    <>
      <main className={styles.page}>
        <header className={styles.header}>
          <Title1>Agent Provisioning</Title1>
          <Caption1>
            Create a user-owned provisioning overlay for any repository or user Blueprint. The
            Blueprint catalog remains the single source of identity; repository artifacts are never edited.
          </Caption1>
          <a href={import.meta.env.BASE_URL}>Back to Blueprint catalog</a>
        </header>

        <section className={styles.panel} aria-label="Local provisioning setup instructions">
          <Subtitle1>Local setup and end-to-end flow</Subtitle1>
          <Caption1>
            The browser never receives local paths or cloud credentials. Install the loopback
            companion locally, approve workspaces in its configuration, and pair this page with
            the one-use code printed by the server.
          </Caption1>
          <div className={styles.setupGrid}>
            <div className={styles.setupStep}>
              <strong>1. Install the companion</strong>
              <Caption1>Node.js 24 or newer is required.</Caption1>
              <pre className={styles.code}>{
`git clone https://github.com/nsreehari/gik-samples.git
cd gik-samples/packages/mcp-server
npm install`
              }</pre>
            </div>
            <div className={styles.setupStep}>
              <strong>2. Configure one local file</strong>
              <ol className={styles.setupList}>
                <li>Copy <code>.env.template</code> to <code>.env</code>.</li>
                <li>Set <code>GIK_WORKSPACE_ROOTS</code> to approved <code>id=path</code> entries.</li>
                <li>Set <code>GIK_ALLOWED_ORIGINS</code> to this page&apos;s exact origin.</li>
                <li>For Foundry, set <code>AZURE_AI_FOUNDRY_PROJECT_ENDPOINT</code>.</li>
              </ol>
              <a
                href="https://github.com/nsreehari/gik-samples/tree/main/packages/mcp-server"
                target="_blank"
                rel="noreferrer"
              >
                Open complete companion configuration reference
              </a>
            </div>
            <div className={styles.setupStep}>
              <strong>3. Add provider prerequisites</strong>
              <Caption1>Copilot: install and authenticate GitHub Copilot CLI.</Caption1>
              <Caption1>Foundry: run <code>az login</code>, then install the optional SDK peers.</Caption1>
              <pre className={styles.code}>{
`npm install @azure/ai-projects@^2.3.0 @azure/identity@^4.13.1`
              }</pre>
            </div>
            <div className={styles.setupStep}>
              <strong>4. Start and pair</strong>
              <pre className={styles.code}>{
`npm run start:http -- --port 7801`
              }</pre>
              <Caption1>
                Enter the printed one-use code below. Then select a Blueprint, choose a provider,
                give the agent a new ID, and run Generate → Preview → Apply → Verify → Smoke test.
              </Caption1>
            </div>
          </div>
        </section>

        <div className={styles.grid}>
          <section className={styles.panel} aria-label="Agent provisioning profile">
            <Subtitle1>1. Blueprint and profile</Subtitle1>
            <Field label="Blueprint">
              <select
                className={styles.select}
                value={blueprintId}
                onChange={(event) => setBlueprintId(event.currentTarget.value)}
              >
                {blueprints.map((entry) => (
                  <option key={entry.payload.id} value={entry.payload.id}>
                    {entry.payload.id} @ {entry.payload.version}
                    {catalog.seedEntries[entry.payload.id] ? " (repository)" : " (user)"}
                  </option>
                ))}
              </select>
            </Field>
            {profile ? (
              <>
                <div className={styles.fieldGrid}>
                  <Field label="Provider">
                    <select
                      className={styles.select}
                      value={profile.provider}
                      onChange={(event) => setProfile(profileFrom(profile, {
                        provider: event.currentTarget.value as AgentProvisioningProfile["provider"],
                      }))}
                    >
                      <option value="copilot">Copilot workspace</option>
                      <option value="foundry">Microsoft Foundry</option>
                    </select>
                  </Field>
                  <Field label="Agent ID">
                    <Input value={profile.agentId} onChange={(_, data) =>
                      setProfile(profileFrom(profile, { agentId: data.value }))} />
                  </Field>
                  <Field label="Model">
                    <Input value={profile.model} onChange={(_, data) =>
                      setProfile(profileFrom(profile, { model: data.value }))} />
                  </Field>
                  <Field label="Registered workspace root ID">
                    <Input
                      value={profile.workspaceRootId}
                      disabled={profile.provider === "foundry"}
                      onChange={(_, data) =>
                        setProfile(profileFrom(profile, { workspaceRootId: data.value }))}
                    />
                  </Field>
                </div>
                <Field label="Description">
                  <Input value={profile.description} onChange={(_, data) =>
                    setProfile(profileFrom(profile, { description: data.value }))} />
                </Field>
                <Field label="Instructions">
                  <Textarea
                    resize="vertical"
                    rows={8}
                    value={profile.instructions}
                    onChange={(_, data) =>
                      setProfile(profileFrom(profile, { instructions: data.value }))}
                  />
                </Field>
                <div className={styles.actions}>
                  <Button appearance="primary" onClick={saveAndGenerate}>Save and generate plan</Button>
                  <Button disabled={!plan} onClick={download}>Download plan</Button>
                </div>
              </>
            ) : null}
          </section>

          <section className={styles.panel} aria-label="Provisioning plan and local companion">
            <Subtitle1>2. Review and provision</Subtitle1>
            <Field label="Local companion port">
              <Input
                type="number"
                min={1}
                max={65_535}
                step={1}
                value={port}
                contentBefore="http://127.0.0.1:"
                onChange={(_, data) => setPort(data.value)}
              />
            </Field>
            <Field label="One-use pairing code">
              <Input
                type="password"
                autoComplete="off"
                value={pairingCode}
                onChange={(_, data) => setPairingCode(data.value)}
              />
            </Field>
            <div className={styles.actions}>
              <Button onClick={pair}>Pair local companion</Button>
              <Button disabled={!plan || !client} onClick={previewServer}>Preview server changes</Button>
              <Button appearance="primary" disabled={!serverPlan} onClick={apply}>Apply</Button>
              <Button disabled={!serverPlan} onClick={verify}>Verify</Button>
            </div>
            {plan ? (
              <>
                <Caption1>Deterministic local plan</Caption1>
                <pre className={styles.code}>{JSON.stringify(plan, null, 2)}</pre>
              </>
            ) : null}
            {serverPlan ? (
              <>
                <Caption1>Server-side revalidated actions</Caption1>
                <pre className={styles.code}>{JSON.stringify(serverPlan, null, 2)}</pre>
              </>
            ) : null}
            {plan?.provider === "copilot" ? (
              <>
                <Field label="Copilot prompt (workspace tools may modify files; shell is denied)">
                  <Textarea
                    resize="vertical"
                    value={runPrompt}
                    onChange={(_, data) => setRunPrompt(data.value)}
                  />
                </Field>
                <Button disabled={!client} onClick={runCopilot}>Run provisioned agent</Button>
              </>
            ) : (
              <>
                <Field label="Foundry smoke-test prompt">
                  <Textarea
                    resize="vertical"
                    value={runPrompt}
                    onChange={(_, data) => setRunPrompt(data.value)}
                  />
                </Field>
                <Button disabled={!serverPlan} onClick={runFoundry}>Run Foundry smoke test</Button>
              </>
            )}
            <div className={styles.status} role="status">{status}</div>
            {error ? <div className={styles.error} role="alert">{error}</div> : null}
          </section>
        </div>
      </main>
      <ApplicationSwitcher />
    </>
  );
}
