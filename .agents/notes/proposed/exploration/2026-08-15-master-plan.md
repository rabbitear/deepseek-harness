# Master Plan — Low-Resolution UI for DeepSeek Harness — 2026-08-15

Status: proposed — overall project plan.

## Project summary

We are building a **compact UI layout plugin** (`@deepseek-ai/dsh-client-ui-layout-compact`) for the DeepSeek Harness web GUI, optimized for low-resolution monitors (1366×768 laptops, 1280×1024 Dell monitors, 1024×768 15" monitors). The plugin replaces the standard three-column layout with tighter geometry while keeping all existing feature plugins compatible.

## Files created so far

| File | Content |
|---|---|
| `.agents/notes/proposed/exploration/2026-08-15-ui-layout-and-theming.md` | Exploration of existing UI layout, theme system, pixel measurements |
| `.agents/notes/proposed/exploration/2026-08-15-compact-layout-plugin-design.md` | Design for the compact layout plugin |
| `.agents/notes/proposed/exploration/2026-08-15-input-box-reading-mode.md` | Future feature: auto-collapse input box while reading |
| `.agents/notes/proposed/exploration/2026-08-15-master-plan.md` | This file — overall project roadmap |
| `scripts/agent-note-tree.ts` | Added `exploration` class to the closed set |
| `.agents/notes/README.md` | Added exploration class documentation |

## Git workflow

1. Create branch: `git checkout -b feature/compact-ui-layout`
2. Work in this branch — all commits go here
3. When complete: `git checkout main && git merge feature/compact-ui-layout`
4. Or use `gh pr create` for a proper PR review

## Completed scaffold (2026-08-17)

All 13 source files created in `packages/client/ui-layout-compact/`:
- Package skeleton, tsconfig, tsdown config, README
- All source files (columns.ts, stores.ts, service.ts, theme-presenter.ts, AppFrame.tsx, AppFrame.module.css, index.ts)
- Invariant companion, CSS modules declaration

Bundle integration done:
- `cordis.patch.yml` — replaced `ui-layout` row with `ui-layout-compact`
- `package.json` — replaced dependency
- `tsconfig.client.json` — added aggregate reference

## Completed tests (2026-08-17)

3 test files in `packages/client/ui-layout-compact/tests/`:
- `columns.client.spec.ts` — compact geometry solver with 1366px/1024px/768px scenarios
- `layout-store.client.spec.ts` — compact store defaults and action clamps
- `service.client.spec.ts` — LayoutController delegation (identical contract)

## Nix development environment (2026-08-17)

Two files created:
- `flake.nix` — flake-based dev shell (Node.js 24.x, pnpm 11.x, git, TypeScript, tsx, Python, build utils)
- `shell.nix` — traditional nix-shell entry point (same deps)

Usage: `nix-shell` brings up the environment with all dependencies.
Corepack strict mode disabled so pnpm from Nix is used directly.

## Phased approach

### Phase 1 — Layout geometry (current scope)
- Replace AppFrame with compact column widths
- Tighter sidebar rail (56px → 32px)
- Lower auto-collapse breakpoint (1024 → 768)
- Smaller center min (640 → 480)
- Compact padding in the frame itself

### Phase 2 — Conversation density (future)
- `data-dsh-compact` attribute for feature CSS overrides
- Smaller fonts, tighter bubbles, reduced padding in conversation
- Compact sidebar variant

### Phase 3 — Reading mode (future, separate)
- Auto-collapse input box when scrolling through output
- See `input-box-reading-mode.md`

## Open decisions
- How does the compact sidebar render at 32px rail?
- Conversation CSS overrides: data attribute or CSS modules swap?
- Details panel availability at 1024×768
