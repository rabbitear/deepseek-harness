# @deepseek-ai/dsh-client-ui-layout-compact

English | [中文](README.zh.md)

Compact shell plugin: three-column AppFrame (drag handles and concession chain) optimized for low-resolution screens (≤1366px wide) plus the `ctx.layout` panel-geometry service. This package is a drop-in replacement for `@deepseek-ai/dsh-client-ui-layout` — it registers into the runtime-owned `root` slot and declares the same `sidebar`, `conversation`, `details`, and `shell.overlay` child slots with identical owner-shape contracts, so all feature plugins work unchanged.

Geometry changes from the standard layout:

| Constant | Standard | Compact | Rationale |
|---|---|---|---|
| `CENTER_MIN` | 640 | 480 | Less room needed for conversation on small screens |
| `SIDEBAR_MIN` | 264 | 180 | Sidebar nav fits in tighter space |
| `SIDEBAR_MAX` | 420 | 320 | Sidebar doesn't dominate the viewport |
| `SIDEBAR_DEFAULT` | 280 | 220 | Default feels proportional on 1366px |
| `SIDEBAR_COLLAPSED` | 56 | 32 | 24px icons need less rail padding |
| `SIDEBAR_AUTO_COLLAPSE` | 1024 | 768 | Collapse earlier for 1024px and smaller screens |
| `DETAILS_MIN` | 300 | 260 | Details panel compact enough for 1366px |
| `DETAILS_MAX` | 520 | 440 | Cap keeps details from squeezing center |
| `DETAILS_DEFAULT` | 360 | 300 | Smaller default leaves more room for conversation |

The sidebar resize boundary is an invisible hit strip, while the details boundary retains its floating pill; only details shrinks during concession and then auto-closes. A closed sidebar retains a 32px control rail while details closes to zero width. The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document.

AppFrame always mounts the conversation and details columns; a connected Session renders through `SessionProvider`. The transient layout store starts the sidebar at its default width and details closed, and it never reads or writes `localStorage`. Hero and other unselected states also derive a zero rendered details width without changing that stored preference. AppFrame retains the last non-blank Session id across those states: the first Session remains closed, an explicit details action opens the contract default width, returning to the same Session restores its unchanged width, and selecting a different Session closes details before paint. The conversation owner share is empty, while the sidebar owner share contains only `collapsed` and `width`; registrants obtain business data from standard hooks and actions from their own inject faces.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, and the four owner-share interfaces. AppFrame, the panel store, and the concession solver remain package-internal.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and details closed; switching between distinct Session ids also closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel restores itself when the window widens; consumers must not read the stored details width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
- **32px collapsed rail** — the standard ui-sidebar SidebarRoot may need adaptation to fit icons at this rail width; the `data-dsh-compact` attribute (Phase 2) will carry CSS overrides for the sidebar plugin.
