# Compact Layout Plugin Design — 2026-08-15

Status: proposed — design exploration for a low-res monitor layout plugin.

## Goal

A standalone `@deepseek-ai/dsh-client-ui-layout-compact` plugin package that replaces the standard three-column layout (`ui-layout`) with a compact arrangement optimized for screens ≤1366px wide (1366×768 laptops, 1280×1024 Dell monitors, 1024×768 15" monitors).

**Key principle:** we replace `ui-layout` in the profile, not coexist with it. The plugin registers into the `'root'` slot the same way `ui-layout` does, with the same child-slot declarations, so all existing UI plugins (sidebar, conversation, details, shell.overlay) work unchanged.

## Design targets per screen

| Screen | Current center width | Target improvements |
|---|---|---|
| 1366×768 | ~1264px (rail) | Reduce padding, smaller fonts, compact header |
| 1280×1024 | ~1224px (rail) | Same as above, details panel usable |
| 1024×768 | ~968px (rail) | Ultra-compact: rail ≤32px, min padding, smallest readable fonts |

## Specific pixel savings

### Sidebar rail (currently 56px)
- Current: 36×36 icon buttons, 10px side padding, 18px top
- Target: **24px icon grid**, 28px click targets, 4px padding → **~32px rail** (save 24px)
- Collapsed logo row: 36px → 24px
- New session rail button: 36×36 → 24×24

### Center column padding
- Header right padding: 28px → 12px (save 16px)
- Header left padding: 20px → 12px (save 8px)
- Side clearance: 16px → 8px (save 8px per side = 16px)
- Bubble padding: 10px 16px → 6px 10px (save ~12px per bubble)
- Bubble radius: 22px → 12px (visual density)
- Content width cap: 748px → responsive (fill available, cap at 748)
- Font sizes: 16px bubble → 14px, 14px metadata → 12px
- Line heights: 24px → 20px or 18px

### Details panel
- Drag handle visibility: keep but thinner
- Padding inside details: tighten

## Layout changes

### At 1024×768 and below (ultra-compact)
- Sidebar rail: **32px** (not 56px)
- Details panel: **auto-closes earlier** (center min lowered to 480px?)
- Font: **13px body, 12px metadata**
- Header: **collapsed to single row, minimal padding**
- Icon sizes: **16px default** instead of 24px

### At 1280×1024 (moderate compact)
- Sidebar rail: **32px**
- Font: **14px body, 13px metadata**
- Normal padding but tighter

### At 1366×768 (light compact)
- Sidebar rail: **32px** (or keep 56px but tighter icons)
- Font: **14px body**
- Slightly reduced padding

## Implementation approach

### Slot contract compatibility
The compact layout declares the **exact same child slots** as `ui-layout`:
- `sidebar` (single/root, SidebarOwnerProps)
- `conversation` (single/session-maybe, ConvOwnerProps)
- `details` (single/session, DetailsOwnerProps)
- `shell.overlay` (list/root)

This means `ui-sidebar`, `ui-conversation`, and all other plugins work without changes. The only difference is the geometry constants and AppFrame component.

### Column solver
New `compact-columns.ts` with adjusted constants:
```
CENTER_MIN = 480         # Was 640 — conversation works fine at 480
SIDEBAR_MIN = 180        # Was 264 — compact sidebar can be narrower
SIDEBAR_MAX = 320        # Was 420
SIDEBAR_DEFAULT = 220    # Was 280
SIDEBAR_COLLAPSED = 32   # Was 56 — 24px icon grid
SIDEBAR_AUTO_COLLAPSE = 768  # Was 1024 — stay expanded longer
DETAILS_MIN = 260        # Was 300
DETAILS_MAX = 440        # Was 520
DETAILS_DEFAULT = 300    # Was 360
```

### Theme integration
The compact layout uses the **existing theme system** (`ctx.theme`) for colors. No theme changes needed. Optionally we can add a `--dsh-compact` CSS custom property that feature components can check for density adjustments.

### CSS strategy
Two approaches:
1. **New CSS modules** in the compact-layout package with compact values — feature plugins unchanged, only the frame and its direct children adapt
2. **Global compact tokens** — set `--dsh-compact: true` on body, feature CSS modules respond

Approach 1 is cleaner for v1: only the layout plugin and maybe a companion compact-sidebar plugin need changes. Conversation etc. get their width from the frame, so narrower columns naturally produce tighter layouts.

But for real density in the conversation view (smaller fonts, tighter bubbles), we'd need either:
- A **compact preset for ConversationRoot** that swaps CSS modules, or
- A **`data-compact` attribute** on the center column that conversation CSS responds to

Approach 2 (global token) may be simpler for v1: add `data-dsh-compact` to body when the compact layout is active, and each feature adds compact overrides in its own CSS modules. The compact-layout plugin sets the attribute; no feature plugin changes needed except CSS additions.

### Package structure
```
packages/client/ui-layout-compact/
  package.json         # @deepseek-ai/dsh-client-ui-layout-compact
  tsconfig.json        # extends tsconfig.base.client.json
  tsdown.config.ts     # clientBundle
  README.md
  src/
    index.ts           # Host half (empty apply)
    invariant.ts       # Runtime invariant companion
    css-modules.d.ts
    client/
      index.ts         # Plugin body: register CompactAppFrame into 'root'
      AppFrame.tsx      # Compact three-column frame
      AppFrame.module.css
      columns.ts        # Compact geometry constants + solver
      stores.ts          # Layout store (same actions as ui-layout)
      service.ts         # LayoutController (same ILayout contract)
      theme-presenter.ts # Same theme presenter
```

### Profile/bundle integration
In `cordis.patch.yml`, replace:
```yaml
    - id: ui-layout
      name: '@deepseek-ai/dsh-client-ui-layout'
```
with:
```yaml
    - id: ui-layout
      name: '@deepseek-ai/dsh-client-ui-layout-compact'
```

Or add an optional `--compact` flag that swaps the row via a patch overlay.

## Open questions

1. **How does the compact sidebar render?** The `ui-sidebar` plugin renders SidebarRoot with the same props. At 32px rail, there's no room for whale logo + panel toggle + new session button. Options:
   - Drop the whale logo in rail mode (just the panel toggle)
   - Use a single 24px icon for new session
   - Register a separate compact-sidebar plugin

2. **Conversation density** — the biggest visual win is smaller fonts and tighter bubbles in the chat. This requires CSS changes in `ui-conversation`. A `data-dsh-compact` attribute on the frame lets conversation CSS add `--compact-font-size` overrides.

3. **Details panel at small screens** — at 1024×768, with 32px rail, center gets ~992px. Details at 300px would leave 692px for center — below CENTER_MIN (480). Details auto-closes. Should we lower the threshold or accept details being unavailable at this size?

4. **Testing** — how do we verify the compact layout works with all existing slot occupants?
