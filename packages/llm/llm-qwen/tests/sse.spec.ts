import { describe, expect, it } from 'vitest'
import { parseSse, parseFallbackBody, LlmStreamClosedError } from '../src/sse.ts'
import type { SseEvent } from '../src/sse.ts'
import { mapTokenUsage, toFinishReason } from '../src/adapter.ts'

/** Build a ReadableStream from a string for parseSse input. */
function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

/** Collect all events from a string body. */
async function collect(text: string): Promise<SseEvent[]> {
  const out: SseEvent[] = []
  for await (const e of parseSse(streamOf(text))) out.push(e)
  return out
}

describe('parseSse', () => {
  it('parses OpenAI-style SSE data lines with blank-line terminators', async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      '',
      '',
      'data: [DONE]',
      '',
      '',
    ].join('\n')
    const events = await collect(body)
    expect(events[0]).toEqual({ kind: 'chunk', json: { choices: [{ delta: { content: 'hi' } }] } })
    expect(events[1]).toEqual({ kind: 'done' })
  })

  it('classifies a plain JSON body as a single body event', async () => {
    const json = JSON.stringify({ choices: [{ message: { content: 'ok' } }] })
    const events = await collect(json)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ kind: 'body', json: { choices: [{ message: { content: 'ok' } }] } })
  })

  it('treats a missing [DONE] over a non-JSON body as a closed-stream error', async () => {
    // A body with data lines but no [DONE].
    const body = ['data: {"choices":[{"delta":{"content":"x"}}]}', '', ''].join('\n')
    const events = await collect(body)
    expect(events[0]!.kind).toBe('chunk')
  })

  it('throws LlmStreamClosedError for a recognized-but-invalid body', async () => {
    await expect(collect('not json at all')).rejects.toBeInstanceOf(LlmStreamClosedError)
  })
})

describe('parseFallbackBody', () => {
  it('extracts choices and usage, omitting absent fields', () => {
    const parsed = parseFallbackBody({
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    })
    expect(parsed.choices?.[0]).toEqual({ message: { content: 'hi' } })
    expect(parsed.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2 })
  })

  it('omits usage when absent', () => {
    const parsed = parseFallbackBody({ choices: [] })
    expect(parsed.usage).toBeUndefined()
  })
})

describe('mapTokenUsage', () => {
  it('maps prompt_tokens/completion_tokens to input/output', () => {
    expect(mapTokenUsage({ prompt_tokens: 10, completion_tokens: 4 }))
      .toEqual({ inputTokens: 10, outputTokens: 4 })
  })

  it('maps reasoning_tokens when present', () => {
    expect(mapTokenUsage({ prompt_tokens: 1, completion_tokens: 1, reasoning_tokens: 5 }))
      .toEqual({ inputTokens: 1, outputTokens: 1, reasoningTokens: 5 })
  })
})

describe('toFinishReason', () => {
  it('maps tool_calls to tool-calls', () => {
    expect(toFinishReason('tool_calls')).toEqual({ kind: 'tool-calls' })
  })
  it('maps stop to stop', () => {
    expect(toFinishReason('stop')).toEqual({ kind: 'stop' })
  })
  it('maps length to max-tokens', () => {
    expect(toFinishReason('length')).toEqual({ kind: 'max-tokens' })
  })
  it('maps unknown to an error reason', () => {
    const r = toFinishReason('content_filter')
    expect(r.kind).toBe('error')
  })
})
