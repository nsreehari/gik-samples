# GIK Samples

Community-facing components, Blueprint samples, and the browser App Host for the Generative Interaction Kernel.

Phase 0 preserves the existing curated Blueprint bootstrap catalog and publishes the browser experience at `/`, selected Blueprints through `?b=<id>`, and Storybook at `/storybook/`. Core `@gik/*` dependencies temporarily resolve from the integrity-checked package archives under `vendor/gik-packages` until trusted npm publication is available.

Production builds use reserved example proxy origins by default. Set
`VITE_GIK_FOUNDRY_PROXY_ORIGIN` and `VITE_GIK_HTTP_PROXY_ORIGIN` to the public
deployment endpoints when building a hosted release.

## Development

```sh
npm ci --no-audit --no-fund
npm run dev
```

The committed vendored packages are validated during every production build. Run
`npm run validate:vendor` directly to verify their provenance, checksums, and
contents without building the application.

## Validation

```sh
npm run build
npm run typecheck
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements,
[SUPPORT.md](SUPPORT.md) for support boundaries, and [SECURITY.md](SECURITY.md)
for private vulnerability reporting.
