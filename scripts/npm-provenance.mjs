export function assertProvenance(attestations, repository, commit) {
  const uri = `git+https://github.com/${repository}`;
  const fromRepository = (value) => typeof value === "string" && (value === uri || value.startsWith(`${uri}@`));
  const valid = attestations.attestations?.some((entry) => {
    if (!["https://slsa.dev/provenance/v1", "https://slsa.dev/provenance/v0.2"].includes(entry.predicateType)) return false;
    try {
      const statement = JSON.parse(Buffer.from(entry.bundle.dsseEnvelope.payload, "base64").toString("utf8"));
      if (statement.predicateType !== entry.predicateType) return false;
      const predicate = statement.predicate;
      if (entry.predicateType.endsWith("/v1")) {
        const workflow = predicate.buildDefinition.externalParameters.workflow;
        return workflow.repository === `https://github.com/${repository}`
          && workflow.path === ".github/workflows/publish.yml"
          && predicate.buildDefinition.resolvedDependencies.some((dependency) =>
            fromRepository(dependency.uri) && dependency.digest?.gitCommit === commit);
      }
      const config = predicate.invocation.configSource;
      return fromRepository(config.uri) && config.digest?.sha1 === commit
        && config.entryPoint === ".github/workflows/publish.yml";
    } catch { return false; }
  });
  if (!valid) throw new Error("npm provenance does not identify the expected repository, source commit and publishing workflow");
}

export async function fetchProvenance(dist) {
  const url = new URL(dist.attestations.url);
  if (url.origin !== "https://registry.npmjs.org" || url.username || url.password
    || !url.pathname.startsWith("/-/npm/v1/attestations/")) throw new Error("Unexpected npm attestation URL");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`npm attestation HTTP ${response.status}`);
  return response.json();
}
