# Local PyTorch LLM Adapter — Direct Model Bridge

## Status

**In progress (2026-08-17/18 session).** Design narrowed to extending the host's `torch_native` server with streaming endpoints. Two-environment build:
- **Host NixOS ROCm env** (unreachable from the dsh jail): owns the model, `torch_native` source, Python env.
- **dsh jail** (this sandbox): owns the Cordis adapter, connects over the jail-permitted network to `:8890`.

## Environment Facts (learned this session)

- The dsh harness runs in a **bubblewrap jail** (`jail.nix`, `dsh-jail`). Network is allowed; `/nix/store` is readonly; `/mnt/blue` is NOT mounted into the jail.
- The jail **cannot** reach `/mnt/blue/shared/models` (host `HF_HOME`), the `pytorch-native` flake source, or the ROCm Python env. Spawning a torch subprocess from inside the jail is impossible.
- The host runs `torch-native-server`: a systemd service in the `pytorch-native` flake ROCm env, serving Qwen3 at `http://127.0.0.1:8890`. The jail CAN reach this over TCP (verified: `/health` → 200).
- ROCm == exposed as CUDA (`device="cuda"`). gfx1151 (Strix Halo). Env: `ROCm_PATH=${rocm.clr}`, `AMDGPU_TARGETS=gfx1151`, `HSA_OVERRIDE_GFX_VERSION=11.5.1`, `HF_HOME=/mnt/blue/shared/models`.
- **Critical quirk:** MIOpen must be disabled (`torch.backends.cudnn.enabled = False` via a `sitecustomize.py` shim) or `F.conv1d` crashes on gfx1151. `attn_implementation="sdpa"` (never flash_attention_2 on ROCm).
- Server endpoints: `/v1/models`, `/v1/chat/completions` (POST), `/health`. **`stream: true` is currently ignored** — returns full non-streamed JSON.

## Chosen Design (this session)

Extend `torch_native` (in the ROCm env) to expose a **streaming endpoint** — SSE/WebSocket over the existing `:8890` — that yields `reasoning` vs `token` deltas and tool calls. Model stays resident in ROCm; the jail reaches it over permitted TCP. The harness adapter consumes that stream and maps it to `ctx.llm` (`LlmAdapter.stream` → `StreamChunk`).

Rejected alternatives (why): a separate socket bridge was close to the original stdin/stdout plan but adds a process to manage while the server already holds the model; reusing the OpenAI-compatible endpoint today loses raw token/reasoning/tool control and does not honor streaming.

## Why the adapter must be a STATIC harness package (not a dynamic plugin)

Discovered this session: the **dynamic Cordis plugin sandbox blocks** `require`, `process`, `fetch`, `WebSocket`, and raw sockets (verified empirically — `fetch` probe was rejected: "Network access goes through the cordis web service"). Its only network surface is `ctx.web.fetch()`, which returns a **complete body, not a stream**. So a dynamic plugin *cannot* stream tokens from the server.

Real streaming lives in a **static package** under `packages/` — the shipped `DeepSeekAdapter` (packages/llm/llm-deepseek) uses `fetch` + `eventsource-parser` + `ReadableStream` + SSPE, none of which the dynamic sandbox offers. The custom adapter must therefore be a static package mirroring `llm-deepseek`'s structure.

## Server source ground truth (from user's torch_native)

- `ModelBackend` protocol: `model_id()`, `embed()`, `generate(messages, *, max_tokens, temperature, top_p, tools, chat_template_kwargs) -> str`, `close()`.
- `TransformersBackend.generate()` calls `self._model.generate(**inputs, **gen_kwargs)` (NON-streaming) and returns a `str`, with `split_thinking_tokens()` separating `<think>...</think>` reasoning and `parse_tool_calls()` (Qwen3 `<tool_call>` blocks) applied at the Flask route.
- `TorchNativeEngine` keeps stats (`generate_calls`, `generate_tokens`, `total_seconds`, `last_reasoning_content`).
- **The streaming gap:** `generate()` returns `str`, so the route can only emit one blob. To honor `stream: true` it must become a token iterator (transformers `generate(..., stream=True)` — v4.47+ — or a manual token loop) and yield `reasoning`/`token`/`tool-call`/`finish` events.

## Objective

## Background

The user runs a Strix Halo (128GB shared VRAM/system memory) with a Qwen 27B model at BF16 consuming ~55GB. Running a Flask server that wraps PyTorch in an OpenAI-compatible API adds:

- HTTP overhead per token (JSON serialize/deserialize, TCP)
- No access to model-internal state (KV cache, logits, sampling parameters)
- Forces the harness to speak HTTP when both processes are on the same machine

The harness `ctx.llm` service already defines an abstract `LlmAdapter` with one required method:

```typescript
abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

A custom adapter can replace the entire wire transport. The harness does not care what protocol the model speaks.

## Adapter Contract

Every adapter must implement:

```typescript
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. Convert options.messages → token IDs (tokenizer)
    // 2. Run model forward pass (PyTorch)
    // 3. Yield text deltas, reasoning deltas, tool calls, finish
    // 4. Handle options.signal for abort
  }
}
```

### StreamChunk types the adapter yields

| Type | Meaning |
|---|---|
| `{ type: 'text-delta', text: "hello" }` | Partial text token |
| `{ type: 'reasoning-delta', text: "..." }` | Chain-of-thought tokens |
| `{ type: 'tool-call-delta', id, name, argumentsDelta }` | Tool call (partial JSON) |
| `{ type: 'block-end', block }` | Complete content block |
| `{ type: 'usage', usage }` | Token counts |
| `{ type: 'finish', reason }` | Generation complete |

### GenerateOptions the adapter receives

| Field | Purpose |
|---|---|
| `messages: Message[]` | Conversation history |
| `model: string` | Model name |
| `tools?: ToolSchema[]` | Tool definitions |
| `temperature?: number` | Sampling temp |
| `maxTokens?: number` | Output limit |
| `signal?: AbortSignal` | Cancellation |
| `system?: string` | System prompt |

## Proposed Bridge Architecture

### Option A: Unix Socket / stdin/stdout (simplest)

```
Harness process (Node.js)
    │
    │  spawn Python process holding model in memory
    │  communicate via JSON-over-stdin/stdout or a Unix socket
    │
    ▼
Python process (torch, triton, etc.)
    │
    │  tokenize → forward() → sample → detokenize → stream
    │
    ▼
    yields tokens back as UTF-8 text lines
```

- Model process stays alive across requests (load once, keep KV cache warm)
- Communication: newline-delimited JSON or a simple binary framing
- Abort: send SIGINT or a cancel message

### Option B: Shared memory / posix_ipc (lower latency)

- Use `torch.multiprocessing` shared tensors or `posix_ipc` shared buffers
- Node.js process maps the same shared memory via a native addon or FFI
- Higher throughput, more complex

### Option C: Direct C extension / PyTorch C++ API

- Write a Node.js native addon that links against libtorch
- Zero-copy: harness process calls model forward() directly
- Highest effort, best latency

**Recommendation for v0**: Option A (stdin/stdout JSON). Easy to debug, no native code, easy to swap tokenizer.

## Tokenizer

The hardest part. The harness works in **text** (strings), the model works in **token IDs**. Need to load Qwen's tokenizer (tiktoken or HuggingFace `tokenizers`).

- Python side loads `AutoTokenizer.from_pretrained("Qwen/Qwen2.5-27B")`
- Node.js side could use a JS tokenizer library, but simplest is: send text to Python, get token IDs back

For v0, the Python process handles both tokenization and generation:

```
Request:  {"type":"generate","messages":[...],"temperature":0.7,"maxTokens":4096}
Response: {"type":"token","text":"Hello"}  (newline-delimited JSON per token)
Response: {"type":"token","text":" world"}
Response: {"type":"usage","inputTokens":42,"outputTokens":12}
Response: {"type":"finish","reason":"stop"}
```

## Tool Call Handling

Qwen models support tool calls via JSON output in the chat template. The adapter must:

1. Detect when the model outputs a tool call pattern
2. Yield `{ type: 'tool-call-delta', ... }` chunks
3. The harness agent loop handles the actual tool execution

The Python process can emit a structured `tool-call` message instead of raw text:

```
Response: {"type":"tool-call","name":"search","arguments":"{\"query\":\"...\"}"}
```

## What the Plugin Looks Like

A Cordis plugin that:

1. Registers an adapter for provider `qwen-local`
2. Spawns/manages the Python subprocess
3. Implements `stream()` by sending requests to the subprocess

The plugin is a dynamic Cordis plugin — defined at runtime via `cordis_define`, registered into `ctx.llm`, and the agent loop can call it immediately.

## Next Steps

1. **Server side (host ROCm env — you):** add a streaming endpoint to `torch_native`, e.g. `POST /v1/chat/completions` honoring `stream: true` with SSE (`data: {json}\n\n`), or a dedicated `/qwen/stream` WebSocket. Must yield `reasoning` vs `answer` deltas and tool-call markers, reusing the model already loaded. Reuse `Qwen/Qwen3-8B` id and confirm the model id the catalog advertises. (Spec + code patch written in `tmp/qwen-bridge/docs/server-streaming-patch.md`.)
2. **Adapter side (done — static package):** `packages/llm/llm-qwen` implements the provider (`qwen-local`) and streams from the endpoint into `StreamChunk`. See the [`qwen-llm-adapter-package` note](2026-07-14-qwen-llm-adapter-package.md). Must be linked (`pnpm install`) + built before it can be loaded.
3. Test end-to-end and reconcile token accounting.

## Open Questions

- How does the Python process manage the KV cache across requests? (per-session caching)
- Should we support multiple models (swap Qwen for another)?
- What sampling parameters does the harness expose vs. what the model supports?
- Tool call format: Qwen uses JSON in the system prompt vs. native tool-use?
- Abort handling: how to stop mid-generation without crashing the Python process?

---

*Proposed during session with user (Strix Halo owner, building a custom agent for 2.5 months). First implementation should be a dynamic plugin prototype showing the bridge pattern.*
