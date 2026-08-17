# Input Box Reading Mode — 2026-08-15

Status: proposed — future feature idea, deferred from v1 compact layout.

## Problem

The input/composer box takes up significant vertical space at the bottom of the conversation view. When scrolling through assistant output to read it, the input box is a large fixed-height bar that reduces the visible transcript area.

The user says: "When I am typing into the input box, its size is fine, no problems. But when I am scrolling through the output to read it, the input box takes up a lot of space on the screen."

## Idea: auto-collapse input bar while reading

The composer bar auto-collapses to a minimal state (single line, maybe just a text cursor or an icon button) when:
1. The user scrolls up in the conversation transcript
2. The user is not actively focusing the input

It re-expands when:
1. The user scrolls back to the bottom
2. The user clicks/taps on the collapsed bar
3. The user presses a keyboard shortcut (e.g. Tab or Enter to resume typing)

## Implementation approaches

### Approach A: Scroll-aware composer
- Detect scroll position relative to the bottom of the transcript
- When scrolled up beyond a threshold (e.g. not within the last 200px of content), shrink composer to a minimal "tap to reply" bar
- On scroll-to-bottom or click on the bar, restore full composer

### Approach B: Focus-aware
- When the input loses focus and the user scrolls, collapse
- On focus (click or keyboard shortcut), expand

### Approach C: Hybrid
- Default: composer visible but smaller when not focused + scrolled away
- Full expand on focus or scroll-to-bottom

## Why deferred

This is a separate concern from the compact layout. The compact layout handles horizontal density (sidebar rail, padding, fonts). The reading mode handles vertical density (composer height while reading). Both can be built independently and composed.

The compact layout plugin could include an initial version of reading mode if desired, but it's cleaner as a separate feature package that injects into the composer slot chain.

## Related files
- `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` — the composer input component
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx` — the scroll body and composer seat
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css` — sticky composer seat with gradient mask
