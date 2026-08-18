# Qwen local adapter package (dsh-llm-qwen)

## Status

**Implemented (source written, typechecks clean, 12 unit tests pass).** Not yet
linked/installed: mounting requires `pnpm install` in the workspace and a host
bundle rebuild, which the jail sandbox cannot run (no pnpm/sed/coreutils, and the
running harness uses the installed `dsh-0.1.0-rc.6` build, not this source tree).

## Decision

Add `packages/llm/llm-qwen/` — a static `@deepseek-ai/dsh-llm-qwen` adapter mirroring
`llm-deepseek` — that registers provider `qwen-local` on `ctx.llm` and streams
from a local OpenAI-compatible chat-completions endpoint over the loopback
network.

## Why a static package (not a dynamic plugin)

The dynamic Cordis plugin sandbox blocks `require`, `process`, `fetch`,
`WebSocket`, and raw sockets; its only network surface is `ctx.web.fetch()`,
which returns a complete body, not a stream. Real streaming (SSE) needs
`fetch` + `ReadableStream`, which only a static package can access — this is how
`llm-deepseek` works (`eventsource-parser` + `fetch`).

## What was rejected

- **Socket/stdin bridge spawned by the harness** — impossible: the jail cannot
  reach `/mnt/blue` (model cache), the ROCm python env, or the `torch-native`
  source, so no torch subprocess can be spawned from inside the jail.
- **Reusing the OpenAI-compatible endpoint as-is** — the server currently ignores
  `stream: true` and returns one blob; this loses raw token/reasoning/tool
  streaming. Kept only as a fallback path in the adapter (parses the JSON body
  when SSE is absent).
- **A separate socket bridge process** — adds a process to manage when the
  server already holds the model in memory.

## Chosen design

- Adapter does `fetch(url + /v1/chat/completions, {stream:true})`, parses SSE
  (`data:` lines), maps `reasoning_content`/`content`/`tool_calls`/`usage`/
  `finish_reason` to harness `StreamChunk`s, falling back to a single JSON body
  when the server ignores `stream`.
- Connection facts resolve per request via a thunk (`options()`), mirroring
  `llm-deepseek`, so config changes reach the next request without restart.
- Server must be extended to honor `stream:true` (spec in
  `tmp/qwen-bridge/docs/server-streaming-patch.md`).

## Required verification before this packages can be used

1. `pnpm install` in the repo (links `@deepseek-ai/dsh-llm-qwen`).
2. `pnpm run build` so packages/llm/llm-qwen emits `lib/`.
3. Add the `llm-qwen` provider — the base bundle already references it.
4. The host `torch-native` server must honor `stream:true` (see the sister spec).

## Files

- `packages/llm/llm-qwen/src/adapter.ts` — `QwenAdapter`, `resolveAdapterOptions`,
  `toFinishReason`, `mapTokenUsage`.
- `packages/llm/llm-qwen/src/sse.ts` — `parseSse` (SSE vs fallback-body), `parseFallbackBody`.
- `packages/llm/llm-qwen/src/index.ts` — plugin `apply`, Config schema, registration.
- `packages/llm/llm-qwen/src/invariant.ts` — package invariant companion.
- `packages/llm/llm-qwen/tests/sse.spec.ts` — 12 unit tests (pass).
- `packages/bundle/base/cordis.patch.yml` + `package.json` — mounted `llm-qwen` entry.
- `tsconfig.host.json` — added `packages/llm/llm-qwen` reference.
