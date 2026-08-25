# GIK Samples

Community-facing components, Blueprint samples, and the browser App Host for the Generative Interaction Kernel.

Phase 0 preserves the existing curated Blueprint bootstrap catalog and publishes the browser experience at `/`, selected Blueprints through `?b=<id>`, and Storybook at `/storybook/`. Core `@gik/*` dependencies temporarily resolve from the adjacent local `gik-fresh` checkout until trusted npm publication is available.

Production builds use reserved example proxy origins by default. Set
`VITE_GIK_FOUNDRY_PROXY_ORIGIN` and `VITE_GIK_HTTP_PROXY_ORIGIN` to the public
deployment endpoints when building a hosted release.
