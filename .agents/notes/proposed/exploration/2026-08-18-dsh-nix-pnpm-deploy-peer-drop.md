# dsh.nix pnpm deploy drops peer packages (`ERR_MODULE_NOT_FOUND`)

## Status

**Diagnosed (2026-08-18).** Root cause identified precisely. Fix pending (user owns
`packages/dsh.nix` — outside this repo).

## Symptom

`dsh` built from `packages/dsh.nix` fails at runtime with:

```
ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-scope' imported from
  .../node_modules/.pnpm/@deepseek-ai+dsh-session@file+++build+source+packages+core+session/...
```

Many loader entries fail identically. A consumer that is `npm install`-ed from the
pre-packed `llm-agents` dsh works; a consumer deployed with `pnpm deploy` fails.

## Root cause

The harness declares cross-package contracts (`@deepseek-ai/dsh-scope`,
`dsh-invariants`, `dsh-sandbox`, `dsh-shell`, `dsh-subprocess`, `dsh-fs`, `dsh-brand`,
`cordis`, …) as **`peerDependencies`** (mirrored in `devDependencies`), and relies on
TypeScript `tsconfig.base.json` `paths` to resolve them at **build** time. At the runtime
consumer they are meant to be provided by **npm's flat hoisting + auto peer install**
(npm 7+): installed packages resolve any peer that another installed package hoists to
the top-level `node_modules`. This is the design the repo's canonical
`scripts/release/verify-packed-install.ts` exercises (it `npm install`s packed tarballs).

`pnpm deploy --filter=@deepseek-ai/dsh --prod` does NOT reproduce this:
- `--prod` omits `devDependencies`, which is where the peer mirrors live.
- A pnpm deploy tree links only each package's `dependencies` into its own `.pnpm` scope.
  Core packages (`dsh-session`, `dsh-agent`) have near-empty `dependencies`; their
  runtime imports are all `peerDependencies`. So nothing is linked → `ERR_MODULE_NOT_FOUND`.

Measured: 35 `@deepseek-ai/*` packages are runtime-imported by the `dsh-base` bundle
closure but absent from that closure's `dependencies` (peer-only). `dsh-scope` is the
first to load and fail; the other 34 fail subsequently.

## The repo's own fix (the target pattern)

`python/sdk-runtime/package.json` is a **dependency-only deploy root**: it lists every
`@deepseek-ai/*` package (defense: `dsh-scope`, `dsh-invariants`, `dsh-sandbox`, …,
~108 deps) as real `dependencies`, so `pnpm deploy materializes this manifest and
node_modules` (its own description). It is exactly the closure a self-contained
`pnpm deploy` target must carry so that peer-provided packages end up on disk.

## Candidate fixes (user decides)

1. **Nix-side, no repo edit:** in `dsh.nix`, deploy a closure that declares the peers —
   most faithfully by mirroring the `sdk-runtime` pattern: a deploy root whose
   `dependencies` include the 35 peer-only packages (all current ones are visible in the
   base-bundle scan). Concretely, change the `pnpm deploy` target/args so peers resolve.
2. **Repo-side (fork):** promote the runtime-imported peer packages to `dependencies` of
   `apps/cli` (or `packages/bundle/base`). More invasive; edits many manifests.
3. **Canonical:** switch the installPhase to `pnpm pack` each `@deepseek-ai/*` + `npm
   install` the tarballs into `$out` (what `verify-packed-install.ts` does). Most faithful
   to upstream, but a larger change than user currently prefers.

## Resolved approach (2026-08-18, user chose)

The deploy-root-as-new-package idea was rejected because it would join the `dsh` release
family (`apps/*/package.json` glob) and trip `verifyPublishable` (private packages cannot
publish). The chosen fix is **two reinforcing parts**:

1. **`apps/cli/package.json`:** add the 18 peer-only runtime packages as real
   `dependencies`. Computed as the peer-only `@deepseek-ai/*` in the full prod+peer
   closure of `apps/cli`: `dsh-anonymous-user-id`, `dsh-atomic-write`, `dsh-bash-local`,
   `dsh-code-runtime`, `dsh-compaction`, `dsh-fs`, `dsh-invariants`, `dsh-output-retention`,
   `dsh-sandbox`, `dsh-scope`, `dsh-session-telemetry`, `dsh-session-title-llm`, `dsh-shell`,
   `dsh-spill`, `dsh-subagent-in-process-driver`, `dsh-subprocess`, `dsh-timeout`,
   `dsh-workflow`. This puts them in the deploy closure (`include.dependencies=true` under
   `--prod`), so they materialize.
2. **dsh.nix:** the deploy tree must be **hoisted** (`node-linker=hoisted`) so a peer
   package at the deploy-root top-level `node_modules` is reachable by walking up from the
   importing package. This is exactly npm's resolution, which is what makes the `llm-agents`
   build work.

## Confirmed from pnpm source (pnpm 11.17)

- `pnpm deploy` with a shared lockfile (`deployFromSharedLockfile`) calls the normal
  install handler with the deploy dir as root and `nodeLinker` carried through `opts3`.
  pnpm's own comments explicitly document `node-linker=hoisted` as a supported deploy
  layout (pruneLockfileImporters handling, "important when node-linker=hoisted").
- `include` filtering: with `--prod`, `dependencies: true, devDependencies: false`, so a
  peer must be in a package's `dependencies` (now true for apps/cli) to survive the deploy.
- The pasted runtime error showed `.pnpm/...` isolated paths, so the user's `node-linker=hoisted`
  `.npmrc` was not reaching the deploy install. The dsh.nix deploy line should pass it
  explicitly (e.g. append `--config.node-linker=hoisted`) rather than relying on `.npmrc`.

**Final dsh.nix deploy line (recommended):**
`pnpm --filter=@deepseek-ai/dsh --prod --ignore-scripts --config.node-linker=hoisted deploy $out`

## Verification

- Rebuild with the chosen fix; `dsh --version` boot must not emit `ERR_MODULE_NOT_FOUND`.
- The model of "npm hoisting provides peers" is confirmed by the working `llm-agents` build.

## Files touched by the diagnosis (read-only)

- `apps/cli/package.json` — thin `dependencies`; `dsh-scope` not declared.
- `packages/core/{session,agent}/package.json` — `dsh-scope` as peer only.
- `packages/bundle/base/cordis.patch.yml` (+ `package.json`) — bundles; `dsh-scope` not a dep.
- `python/sdk-runtime/package.json` — the deploy-root pattern that works.
- `scripts/release/verify-packed-install.ts` — canonical npm-install path.
