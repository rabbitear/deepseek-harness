# Nix development environment and test scaffolding for compact layout — 2026-08-17

Status: proposed — Nix dev environment and compact layout test suite.

## Summary

Two independent pieces completed this session:

### 1. Nix development environment

Created `flake.nix` and `shell.nix` at the repo root. Both provide:
- Node.js 24.x (matching project's `engines` constraint `>=24.0.0`)
- pnpm 11.x (matching `packageManager` pin `pnpm@11.7.0`)
- Git, TypeScript, tsx (needed for `node --import tsx/esm` source launches)
- Bash, coreutils, findutils, grep, make, sed, tar, gzip (needed by tests and shell providers)
- Python 3 (needed for Python SDK)
- landlock-linux (native sandbox dependency)

Corepack strict mode is disabled (`COREPACK_ENABLE_STRICT=0`) so pnpm from Nix
is used directly, avoiding corepack downloading a different version at runtime.

Usage: `nix-shell` at repo root enters the dev environment.

### 2. Compact layout test suite

Created 3 test files matching the pattern from ui-layout:

- **columns.client.spec.ts** — 12 test cases covering the compact geometry
  solver: fit at 1366px, rail width, clamp behavior, concession steps,
  auto-close, degenerate viewports, pure recovery. Added compact-specific
  cases for 1024×768 viewport with sidebar collapsed and re-expanded.

- **layout-store.client.spec.ts** — 8 test cases covering compact store
  defaults (sidebar=220, details=0), clamp ranges (180-320 sidebar, 260-440
  details), toggle semantics, narrow mode, and persistence check.

- **service.client.spec.ts** — 3 test cases covering LayoutController
  delegation (identical to ui-layout's service.ts contract — no geometry
  changes needed).

All tests use the sanctioned test path: `import from ...src/client/...` per
the package conventions.

## Files created/modified

| File | Change |
|---|---|
| `flake.nix` | Created — flake dev shell |
| `shell.nix` | Created — nix-shell dev shell |
| `packages/client/ui-layout-compact/tests/columns.client.spec.ts` | Created |
| `packages/client/ui-layout-compact/tests/layout-store.client.spec.ts` | Created |
| `packages/client/ui-layout-compact/tests/service.client.spec.ts` | Created |
| `.agents/notes/proposed/exploration/2026-08-15-master-plan.md` | Updated — marked scaffold and tests complete |

## Open questions

- Nix `pkgs.typescript` may not match the project's exact TypeScript version
  (^6.0.3). The flake could pin `t typescript` from the project's `devDependencies`
  via `pkgs.nodePackages.typescript-language-server` or a custom derivation.
- `pkgs.landlock-linux` may not exist in all Nixpkgs architectures — should
  be optional (conditional on Linux).
- Test running: needs `pnpm` in PATH. With `nix-shell`, `pnpm run test:gui`
  should work. Without nix, the user must add pnpm/node to PATH manually.
