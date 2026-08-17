# UI Layout and Theming — 2026-08-15

Status: proposed — scratch exploration notes.

## Summary

The Web GUI is a three-column responsive layout with a theme system supporting light/dark palettes and override layers. Layout is driven by a fixed concession chain in `columns.ts`, theming by `ThemeRuntime` + CSS custom properties. There is **no built-in "compact" or "low-res" mode** — the layout assumes ≥1024px viewport and ≥640px center column.

## Three-column layout

**Source:** `packages/client/ui-layout/src/client/columns.ts`

| Column | Min | Max | Default | Auto-collapse |
|---|---|---|---|---|
| Sidebar | 264px | 420px | 280px | at <1024px → 56px rail |
| Center | 640px min | fills remaining | fills | never collapses |
| Details | 300px | 520px | 360px | auto-closed if center < 640px |

**Concession chain (pure function, no hysteresis):**
1. Everything fits → preferred widths
2. Shrink details toward 300px
3. Auto-close details (center absorbs deficit, may drop below 640px)
4. Sidebar **never concedes** — center absorbs the rest

**Key breakpoints:**
- `SIDEBAR_AUTO_COLLAPSE = 1024` — below this sidebar auto-collapses to 56px rail
- `CENTER_MIN = 640` — below this details auto-closes, center may go below 640
- `SIDEBAR_COLLAPSED = 56` — compact rail when sidebar closed

**For your screens:**
- **1366×768 laptop**: viewport ~1320px (after chrome). With sidebar collapsed (56px) and details closed (0), center gets ~1264px — fine.
- **1280×1024**: sidebar collapsed (56px), center ~1224px — fine, details can open.
- **1024×768**: sidebar auto-collapses to 56px rail, center ~968px — fine, details auto-closes below 640+56=696px so center gets ~968px.

## Theme system

**Source:** `packages/client/ui-theme/src/client/index.ts`, `theme-settings.ts`

- Built-in themes: `light`, `dark` (base palettes), preference `system` (follows OS)
- Theme tokens: `--dsw-alias-*` semantic aliases, `--dsw-static-*` raw palette values
- Override layers: plugins can register `ThemeTokenOverrides` (light+dark pairs) stacked in order
- Registration: `ThemeRuntime.register(ThemeDefinition)` returns disposer
- DOM application: `ThemePresenter.apply(snapshot)` sets `color-scheme`, `data-ds-dark-theme`, inline CSS vars
- Settings: preference persisted in user-settings under namespace `ui-theme`

**CSS:** `packages/client/ui-theme/src/styles/`
- `base.css` — font families, motion curves
- `design-platform.css` — static palette + alias tokens (light & dark)
- `shiki.css` — syntax highlighting
- `scrollbar.css` — custom scrollbar styles
- `gradient-shadow-text.css` — text glow effects

**Token inspection API:** `ThemeRuntime.exportInspectTokens()` returns all registered token names for settings UI.

## Actual pixel measurements from CSS

### Sidebar rail (collapsed)
- Rail width: **56px** total
- Padding: **10px sides, 18px top, 6px bottom**
- Icon buttons: **36×36** click targets (24px whale glyph)
- New Session rail button: **36×36**
- Logo row height: **36px** (collapsed), **60px** (expanded)
- Font size: **14px** everywhere

### Center column (conversation)
- Content width cap: **748px** (`--dsh-chat-content-width`)
- Composer card max: **748+32=780px**
- Side clearance: **16px**
- Font sizes: **16px** bubble text, **14px** metadata/crumbs
- Bubble radius: **22px**, padding **10px 16px**
- User bubble max: **525px or 82%**
- Header padding: **28px right, 20px left**
- Tab font: **13px/16px**
- Crumb padding: **4px 8px**, radius **12px**
- Composer text max height: **336px** (14 lines × 24px)

### Details panel
- Min: **300px**, Max: **520px**, Default: **360px**
- Drag handle: **8px hit strip**, visible **12×32 pill**

### Key geometry ratios for 1024×768
With sidebar rail (56px), center gets **968px**. The 748px content cap leaves **220px margin** — mostly padding. With expanded sidebar (280px), center drops to **744px** — barely above the 640px floor, details auto-closes.

## What the current UI lacks for low-res

1. **No font-size/UI-scale adjustment** — no "compact" CSS or zoom-independent scaling
2. **56px rail is wasteful** — 24px icon grid with tight padding would be ~32px
3. **Massive padding everywhere** — 28px header right, 20px left, 16px side clearance, 10px bubble padding, 12px sidebar padding
4. **Large click targets** — 36×36 buttons could be 24×24, 38px new-session bar could be 28px
5. **No alternate layouts** — no single-column "mobile" view, no stacked layout
6. **All geometry is hardcoded px** — no `em`/`rem` scaling factor

## Creating a low-res theme

The theme system supports registering new themes via `ThemeRuntime.register()` with alias-token overrides. But a **layout** change (column widths, font sizes, padding) is not a theme change — themes only override `--dsw-alias-*` color tokens.

For a low-res UI you'd need to either:
- **Option A: New layout plugin** — register a new root slot occupant that replaces AppFrame with a compact single/two-column layout
- **Option B: Modify AppFrame** — add responsive scaling factor, compact mode toggle, or stacked layout at lower breakpoints
- **Option C: CSS-only** — add a `[data-compact]` body attribute and write compact overrides in feature CSS modules (no new plugin needed, but scattered changes)
- **Option D: Theme override tokens for layout** — extend the token set to include sizing/geometry tokens that components consume (like `--dsw-alias-size-unit`, `--dsw-alias-padding-compact`)

The cleanest approach would probably be **Option A or B** — a new or modified layout plugin that provides a compact arrangement for ≤1366px screens, with the theme system handling only colors.
