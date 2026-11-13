export function provenanceSourceCommit(attestations, repository, workflowPath = ".github/workflows/publish.yml") {
  if (![".github/workflows/publish.yml", ".github/workflows/release-service-providers.yml"].includes(workflowPath)) {
    throw new Error("Unsupported publishing workflow");
  }
  const uri = `git+https://github.com/${repository}`;
  const fromRepository = (value) => typeof value === "string" && (value === uri || value.startsWith(`${uri}@`));
  const commits = new Set();
  for (const entry of attestations.attestations || []) {
    if (!["https://slsa.dev/provenance/v1", "https://slsa.dev/provenance/v0.2"].includes(entry.predicateType)) continue;
    const payload = entry.bundle?.dsseEnvelope?.payload;
    if (typeof payload !== "string") throw new Error("Malformed npm provenance payload");
    let statement;
    try { statement = JSON.parse(Buffer.from(payload, "base64").toString("utf8")); }
    catch (cause) { throw new Error("Malformed npm provenance statement", { cause }); }
    if (statement.predicateType !== entry.predicateType) continue;
    const predicate = statement.predicate;
    if (entry.predicateType.endsWith("/v1")) {
      const definition = predicate?.buildDefinition;
      const workflow = definition?.externalParameters?.workflow;
      if (workflow?.repository !== `https://github.com/${repository}` || workflow.path !== workflowPath) continue;
      for (const dependency of definition.resolvedDependencies || []) {
        if (fromRepository(dependency.uri) && /^[a-f0-9]{40}$/.test(dependency.digest?.gitCommit || "")) {
          commits.add(dependency.digest.gitCommit);
        }
      }
    } else {
      const config = predicate?.invocation?.configSource;
      if (fromRepository(config?.uri) && /^[a-f0-9]{40}$/.test(config?.digest?.sha1 || "")
        && config.entryPoint === workflowPath) commits.add(config.digest.sha1);
    }
  }
  if (commits.size !== 1) throw new Error("npm provenance does not identify one expected repository, source commit and publishing workflow");
  return [...commits][0];
}
export function assertProvenance(attestations, repository, commit, workflowPath = ".github/workflows/publish.yml") {
  if (provenanceSourceCommit(attestations, repository, workflowPath) !== commit) {
    throw new Error("npm provenance source commit differs from the expected newly published candidate");
  }
}

export async function fetchProvenance(dist) {
  const url = new URL(dist.attestations.url);
  if (url.origin !== "https://registry.npmjs.org" || url.username || url.password
    || !url.pathname.startsWith("/-/npm/v1/attestations/")) throw new Error("Unexpected npm attestation URL");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`npm attestation HTTP ${response.status}`);
  return response.json();
}

export function assertPublicationSource(commit, eventSha) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? "") || commit !== eventSha) {
    throw new Error("Publication must run from the exact candidate source SHA; dispatch from its immutable release tag");
  }
}
