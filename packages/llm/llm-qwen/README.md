# dsh-llm-qwen

`@deepseek-ai/dsh-llm-qwen` provides a `ctx.llm` adapter that streams tokens from a
**local OpenAI-compatible chat-completions endpoint serving a Qwen model** — for
example the host's `torch-native` server on the loopback network. It lets the
DeepSeek Harness agent loop run against a directly hosted model without any
cloud dependency.

## Why this exists

The model and its ROCm/PyTorch environment live on the host, unreachable from the
jailed harness (`/mnt/blue` model cache, python env, and `/nix/store` source are
not mounted into the jail). But the jail permits the loopback network, so the
adapter reaches the model over `http://127.0.0.1:8890/v1/chat/completions`. The
model stays resident in its own environment; the harness just connects.

## Provider

Registers provider route `qwen-local`, model id `Qwen/Qwen3-8B` (configurable).

## Config (cordis.yml or the `llm-qwen:` settings section)

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | required | Endpoint base; `/v1/chat/completions` is appended. |
| `modelId` | `Qwen/Qwen3-8B` | Model id advertised and forwarded on requests. |
| `defaultContextWindow` | `131072` | Context capacity when the model has no exact value. |
| `maxTokens` | `4096` | Default per-request output cap. |
| `streamIdleTimeoutMs` | `300000` | Maximum idle stream read. |
| `retryPolicy` | normal defaults | Provider-owned retry policy. |

Example:

```yaml
- id: llm-qwen
  name: '@deepseek-ai/dsh-llm-qwen'
  config:
    baseURL: 'http://127.0.0.1:8890'
    modelId: 'Qwen/Qwen3-8B'
    maxTokens: 4096
```

## Streaming

The adapter requests `stream: true`. If the server honors it, SSE `data:` lines
are parsed: `delta.reasoning_content` → `reasoning-delta`, `delta.content` →
`text-delta`, `delta.tool_calls` → `tool-call-delta`, `usage` → `usage`,
`finish_reason` → `finish`. If the server ignores `stream` and returns a single
JSON body, the adapter parses that as a fallback completion instead.

## Known Limitations and Deferred Work

- No authentication by default; `resolveToken` is a no-op. Add it if the model
  endpoint requires a bearer token.
- The adapter maps OpenAI-style `tool_calls` deltas; Qwen's native `<tool_call>`
  blocks must be surfaced by the server as OpenAI-shaped tool_calls (the
  torch-native `parse_tool_calls` already lifts them).
- No KV-cache reuse across turns (the server owns generation).

## Development

```sh
pnpm --filter @deepseek-ai/dsh-llm-qwen test
```
