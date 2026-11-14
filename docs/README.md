# Documentation

Start with the [developer documentation hub](https://nsreehari.github.io/gik-samples/docs/)
for concepts, learning paths, sample prerequisites, package roles, and hosting.
The [sample-app walkthrough](https://nsreehari.github.io/gik-samples/getting-started/)
follows the standalone Finbook reference application.

Studio remains at the [site root](https://nsreehari.github.io/gik-samples/).
Documentation is static and can be opened without starting Studio's runtime.

## Find the owning document

| Need | Authority |
| --- | --- |
| Choose and run a sample; understand host prerequisites | [Sample guide](samples.md) |
| Install or extract the reference app | [Finbook README](../apps/finbook/README.md) |
| Use a component, provider, or authoring tool | [Components](https://github.com/nsreehari/gik-components), [Service Providers](https://github.com/nsreehari/gik-service-providers) and [Storybook](https://nsreehari.github.io/gik-samples/storybook/) |
| Install local tools, pair Studio, or apply a reviewed plan | [MCP companion README](../packages/mcp-server/README.md) |
| Install, build, and validate the repository | [Validation](../VALIDATION.md) |
| Find library release ownership or refresh Pages downloads | [Releasing](../RELEASING.md) |
| Contribute, request support, or report a vulnerability | [Contributing](../CONTRIBUTING.md), [support](../SUPPORT.md), [security](../SECURITY.md) |
| Understand a sample design decision | [Architecture decisions](decisions/README.md) |
| Choose public core packages and understand runtime contracts | [Core documentation](https://github.com/nsreehari/generative-interaction-kernel/blob/master/docs/README.md) |

## Keep the site and repository coherent

- The root README is the repository's entry point, not another API manual.
- Package READMEs own setup and consumer APIs. Link them rather than copying
  their method, tool, version, or configuration inventories into guides.
- The [sample guide](samples.md) owns cross-sample guidance. Tests and source
  remain authoritative for individual behavior cases.
- The [Pages hub source](../src/browser-host/public/docs/index.html) owns task
  navigation and short explanations; the [walkthrough](../src/browser-host/public/getting-started/index.html)
  owns the composition journey. Both use a shared stylesheet.
- Storybook owns component trials and variants, not application orchestration.
- Generated download metadata owns exact release versions and checksums.
- Preserve existing Studio URLs and distinguish browser demos from local
  servers, headless hosts, and examples requiring authorized external services.
