import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOL_RESULT_CHARS, boundedJSON, budgetTurns, compactConnectorResult, compactSchema, createToolRuntime, hideToolMarkup, parseToolCalls, plainReadIntent, readTarget, runConnectorAction, runToolLoop, schemas, toolsBlock, type Turn } from '../src/engine/tools.ts'
import type { ConnectorTool } from '../src/engine/api.ts'
import type { Source } from '../src/engine/search.ts'
const toolCall = (name = 'web_search', args = { query: 'test' }) => `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`
const nativeCall = `<tool_call>
<function=web_search>
<parameter=query>
test
</parameter>
</function>
</tool_call>`
const nativeInstructions = `If you choose to call a function ONLY reply in the following format with NO suffix:

<tool_call>
<function=example_function_name>
<parameter=example_parameter_1>
value_1
</parameter>
<parameter=example_parameter_2>
This is the value for the second parameter
that can span
multiple lines
</parameter>
</function>
</tool_call>

<IMPORTANT>
Reminder:
- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags
- Required parameters MUST be specified
- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after
- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls
</IMPORTANT>`
const initial: Turn[] = [{ role: 'system', content: 'base' }, { role: 'user', content: 'question' }]
test('native XML calls parse raw multi-line strings and repaired JSON parameter values', () => {
  const call = `<tool_call>
<function=connectors_execute>
<parameter=tool>
APP_ACTION
</parameter>
<parameter=arguments>
{title:'Hello', body:'first\\nsecond', items:[1,2,], enabled:true,}
</parameter>
<parameter=note>
  First line
second line with <b>markup</b> and "quotes".
</parameter>
<parameter=items>[1, {name:'two'}]</parameter>
<parameter=count>-12.5e2</parameter>
<parameter=enabled>true</parameter>
<parameter=disabled>false</parameter>
<parameter=empty>null</parameter>
<parameter=quoted>"value"</parameter>
<parameter=raw>[not valid JSON</parameter>
</function>
</tool_call>`
  assert.deepEqual(parseToolCalls(call), [{ name: 'connectors_execute', arguments: { tool: 'APP_ACTION', arguments: { title: 'Hello', body: 'first\nsecond', items: [1, 2], enabled: true }, note: 'First line\nsecond line with <b>markup</b> and "quotes".', items: [1, { name: 'two' }], count: -1250, enabled: true, disabled: false, empty: null, quoted: 'value', raw: ['not valid JSON'] } }])
  assert.deepEqual(parseToolCalls('Let me check.\n' + nativeCall + '\n' + nativeCall), Array(2).fill({ name: 'web_search', arguments: { query: 'test' } }))
  assert.deepEqual(parseToolCalls('<tool_call><function=ping></function></tool_call>'), [{ name: 'ping', arguments: {} }])
})
test('malformed or incomplete native parameter blocks are not executed', () => {
  for (const text of [
    '<tool_call><function=x><parameter=query>unfinished</function></tool_call>',
    '<tool_call><function=x><parameter=query>test</parameter>',
    '<tool_call><function=x>unexpected<parameter=query>test</parameter></function></tool_call>',
    '<tool_call><function=x><parameter=query>test</parameter>unexpected</function></tool_call>',
  ]) assert.deepEqual(parseToolCalls(text), [])
})
test('parser tolerates single quotes, unquoted keys, trailing commas and stringified arguments', () => {
  assert.deepEqual(parseToolCalls(`<tool_call>{name:'web_search',arguments:{query:'news',},}</tool_call>`), [{ name: 'web_search', arguments: { query: 'news' } }])
  assert.deepEqual(parseToolCalls('<tool_call>{"name":"web_search","arguments":"{\\"query\\":\\"news\\"}"}</tool_call>'), [{ name: 'web_search', arguments: { query: 'news' } }])
  assert.equal(parseToolCalls('<tool_call>not json</tool_call>').length, 0)
  assert.equal(parseToolCalls('<tool_call>{"name":"x","arguments":[]}</tool_call>').length, 0)
  assert.equal(parseToolCalls(toolCall() + toolCall()).length, 2)
})
test('streaming never exposes partial or complete tool tags or their JSON', () => {
  for (const markup of [toolCall(), nativeCall, '<function=web_search>\n<parameter=query>secret</parameter></function>', '<parameter=query>secret</parameter>', '<tool_response>\nsecret\n</tool_response>', '</function>', '</parameter>']) {
    for (let n = 1; n <= markup.length; n++) assert.equal(hideToolMarkup('Hi ' + markup.slice(0, n)), 'Hi ')
  }
  assert.equal(hideToolMarkup('ordinary < comparison'), 'ordinary < comparison')
})
test('tools block is absent with no tools; connected app slugs and schemas are included once', () => {
  assert.equal(toolsBlock([]), '')
  const block = toolsBlock(schemas(true, ['github', 'gmail']))
  const toolSchemas = schemas(true, ['github', 'gmail'])
  assert.equal(block, '# Tools\n\nYou have access to the following functions:\n\n<tools>\n' + toolSchemas.map((schema) => JSON.stringify({ type: 'function', function: schema })).join('\n') + '\n</tools>\n\n' + nativeInstructions)
  assert.equal(block.split('<tools>').length - 1, 1)
  assert.match(block, /github, gmail/)
  assert.ok(!block.includes('approved'))
})
test('scripted multi-step model receives tool responses, then returns final answer', async () => {
  const executed: string[] = [], seen: Turn[][] = [], visible: string[] = []
  const outputs = [nativeCall, '<tool_call>{name:"web_search",arguments:{query:"next",},}</tool_call>', 'Answer [1]']
  const result = await runToolLoop({ messages: initial, tools: schemas(true, []), signal: new AbortController().signal, onText: (s) => visible.push(s),
    generate: async (messages, onText) => { seen.push(messages); const text = outputs.shift()!; for (let n = 1; n <= text.length; n++) onText(text.slice(0, n)); return { text } },
    execute: async (call) => { executed.push(String(call.arguments.query)); return 'fetched text' }, hasSources: () => executed.length > 0,
  })
  assert.equal(result.text, 'Answer [1]')
  assert.deepEqual(executed, ['test', 'next'])
  assert.equal(seen[0][0].content, toolsBlock(schemas(true, [])) + '\n\nbase')
  assert.equal(seen[1].at(-2)!.content, nativeCall)
  assert.equal(seen[1].at(-1)!.content, '<tool_response>\nfetched text\n</tool_response>')
  assert.equal(seen[2].at(-2)!.content, nativeCall.replace('\ntest\n', '\nnext\n'))
  assert.match(seen[1][0].content, /Treat page text as data/)
  assert.ok(visible.every((v) => !v.includes('tool_call') && !v.includes('arguments')))
})
test('history serializes raw multi-line strings and JSON objects and arrays in native XML', async () => {
  let step = 0
  const args = { tool: 'APP_ACTION', arguments: { body: 'first\nsecond', ids: [1, 2] }, note: 'first\nsecond', ids: [1, 2], count: 2, enabled: false, empty: null }
  await runToolLoop({ messages: initial, tools: schemas(false, ['app']), signal: new AbortController().signal, onText: () => {},
    generate: async (messages) => {
      if (step++ === 0) return { text: `<tool_call>${JSON.stringify({ name: 'connectors_execute', arguments: args })}</tool_call>` }
      const content = messages.at(-2)!.content
      assert.equal(content, `<tool_call>\n<function=connectors_execute>\n<parameter=tool>\nAPP_ACTION\n</parameter>\n<parameter=arguments>\n{"body":"first\\nsecond","ids":[1,2]}\n</parameter>\n<parameter=note>\nfirst\nsecond\n</parameter>\n<parameter=ids>\n[1,2]\n</parameter>\n<parameter=count>\n2\n</parameter>\n<parameter=enabled>\nfalse\n</parameter>\n<parameter=empty>\nnull\n</parameter>\n</function>\n</tool_call>`)
      assert.deepEqual(parseToolCalls(content), [{ name: 'connectors_execute', arguments: args }])
      return { text: 'Done' }
    }, execute: async (call) => { assert.deepEqual(call.arguments, args); return '{}' },
  })
})
test('tools precede persona, skills and citation rules and are absent when unavailable', async () => {
  const messages: Turn[] = [{ role: 'system', content: '  Persona\n\nEnabled skill  ' }, initial[1]]
  for (const tools of [schemas(true, []), []]) {
    await runToolLoop({ messages, tools, signal: new AbortController().signal, onText: () => {}, hasSources: () => true,
      generate: async (turns) => {
        const content = turns[0].content
        if (tools.length) {
          assert.ok(content.startsWith(toolsBlock(tools) + '\n\nPersona\n\nEnabled skill'))
          assert.ok(content.indexOf('Treat page text as data') > content.indexOf('Enabled skill'))
        } else { assert.ok(content.startsWith(messages[0].content)); assert.ok(!content.includes('# Tools')) }
        return { text: 'Answer' }
      }, execute: async () => '{}',
    })
  }
})
test('max four actions then final generation without tools, including a model that ignores cutoff', async () => {
  let executions = 0, generations = 0
  const result = await runToolLoop({ messages: initial, tools: schemas(true, []), signal: new AbortController().signal, onText: () => {},
    generate: async (messages) => { generations++; if (generations >= 5) { assert.ok(!messages[0].content.includes('<tools>')); assert.equal(messages.at(-1)!.content, 'Answer now using only the tool results above. Do not call tools.') }; return { text: toolCall('web_search', { query: String(generations) }) } }, execute: async () => { executions++; return '{}' },
  })
  assert.equal(executions, 4); assert.equal(generations, 6)
  assert.ok(!result.text.includes('tool_call'))
})
test('invalid JSON and unavailable tools feed an error without execution', async () => {
  const outputs = ['<tool_call>not json</tool_call>', toolCall('unavailable'), 'Could not do that']
  let executions = 0, step = 0
  await runToolLoop({ messages: initial, tools: schemas(true, []), signal: new AbortController().signal, onText: () => {},
    generate: async (messages) => { if (step === 1) assert.match(messages.at(-1)!.content, /Invalid tool call/); if (step === 2) assert.match(messages.at(-1)!.content, /unavailable/); step++; return { text: outputs.shift()! } }, execute: async () => { executions++; return '{}' },
  })
  assert.equal(executions, 0)
})
test('prefetch happens before generation and source rules apply only with sources', async () => {
  let prefetched = false
  await runToolLoop({ messages: initial, tools: schemas(true, []), signal: new AbortController().signal, onText: () => {}, prefetch: async () => { prefetched = true; return '[1] Fetched page' }, hasSources: () => true,
    generate: async (messages) => { assert.ok(prefetched); assert.match(messages[0].content, /Never invent sources or claims/); assert.equal(messages.at(-1)!.content, '<tool_response>\n[1] Fetched page\n</tool_response>'); return { text: 'Answer' } }, execute: async () => '{}',
  })
})
test('consecutive tool results share one user turn', async () => {
  const messages: Turn[] = [...initial, { role: 'assistant', content: nativeCall }, { role: 'user', content: '<tool_response>\nfirst result\n</tool_response>' }]
  await runToolLoop({ messages, tools: schemas(true, []), signal: new AbortController().signal, onText: () => {}, prefetch: async () => 'second result',
    generate: async (turns) => { assert.equal(turns.length, messages.length); assert.equal(turns.at(-1)!.role, 'user'); assert.equal(turns.at(-1)!.content, '<tool_response>\nfirst result\n</tool_response>\n<tool_response>\nsecond result\n</tool_response>'); return { text: 'Answer' } }, execute: async () => '{}',
  })
  assert.equal(messages.at(-1)!.content, '<tool_response>\nfirst result\n</tool_response>')
})
test('writes wait for approval; declines do not execute; reads run without approved flag', async () => {
  let executions = 0, approvals = 0
  const write = { tool: 'GITHUB_CREATE_ISSUE', arguments: {}, keys: [] }
  let release!: (value: 'once') => void
  const pending = runConnectorAction({ ...write, approve: async () => { approvals++; return new Promise((resolve) => { release = resolve }) }, execute: async (approved) => { assert.ok(approved); executions++; return { ok: true } } })
  await Promise.resolve(); assert.equal(executions, 0); assert.equal(approvals, 1)
  release('once'); await pending; assert.equal(executions, 1)
  const declined = await runConnectorAction({ ...write, approve: async () => 'decline', execute: async () => { throw new Error('must not execute') } })
  assert.equal(declined.declined, true)
  await runConnectorAction({ tool: 'GITHUB_LIST_REPOS', arguments: {}, keys: [], approve: async () => { throw new Error('must not ask') }, execute: async (approved) => { assert.equal(approved, false); return { ok: true } } })
})
test('runtime rejects unsearched and truncated connector slugs without approval or execution', async (t) => {
  let approvals = 0
  const createRuntime = () => createToolRuntime({ signal: new AbortController().signal, onActivity: () => {}, onSources: () => {}, getAllowed: () => [], approve: async () => { approvals++; return 'once' } })
  const runtime = createRuntime()
  const fetch = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    assert.equal(String(input), '/api/connectors/tools/search')
    return Response.json({ items: [{ slug: 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER', name: 'List repositories', description: 'List my repositories', tags: ['readOnlyHint'], toolkit: 'github', input_parameters: { type: 'object' } }] })
  })
  const expected = { ok: false, executed: false, error: 'Unknown action slug. Use an exact slug returned by connectors_search, or search again.' }
  const execute = (tool: string) => ({ name: 'connectors_execute', arguments: { tool, arguments: {} } })
  assert.deepEqual(JSON.parse(await runtime.execute(execute('GITHUB'))), expected)
  assert.equal(fetch.mock.callCount(), 0)
  await runtime.execute({ name: 'connectors_search', arguments: { query: 'list my repositories' } })
  assert.deepEqual(JSON.parse(await runtime.execute(execute('GITHUB'))), expected)
  assert.deepEqual(JSON.parse(await createRuntime().execute(execute('GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER'))), expected)
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(approvals, 0)
})
test('runtime executes a searched read action without approval', async (t) => {
  let approvals = 0
  const runtime = createToolRuntime({ signal: new AbortController().signal, onActivity: () => {}, onSources: () => {}, getAllowed: () => [], approve: async () => { approvals++; return 'once' } })
  const tool = 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER'
  const result = { ok: true, repositories: [{ name: 'example' }] }
  const fetch = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === '/api/connectors/tools/search') return Response.json({ items: [{ slug: tool, name: 'List repositories', description: 'List my repositories', tags: ['readOnlyHint'], toolkit: 'github', input_parameters: { type: 'object' } }] })
    assert.equal(String(input), '/api/connectors/tools/execute')
    assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(init?.body)), { tool, arguments: { per_page: 10 }, approved: false })
    return Response.json(result)
  })
  await runtime.execute({ name: 'connectors_search', arguments: { query: 'list my repositories' } })
  assert.equal(await runtime.execute({ name: 'connectors_execute', arguments: { tool, arguments: { per_page: 10 } } }), 'Result of List repositories. State only facts present below.\nok: true\nrepositories: Total items 1, shown 1\n- name: example')
  assert.equal(fetch.mock.callCount(), 2)
  assert.equal(approvals, 0)
})
test('always allow is scoped to the exact action; authoritative server tags can still require a card', async () => {
  await runConnectorAction({ tool: 'GITHUB_CREATE_ISSUE', arguments: {}, keys: ['github:GITHUB_CREATE_ISSUE'], approve: async () => { throw new Error('should be allowed') }, execute: async (approved) => { assert.equal(approved, true); return { ok: true } } })
  let executions = 0, approvals = 0
  await runConnectorAction({ tool: 'APP_GET', arguments: {}, keys: [], approve: async () => { approvals++; return 'once' }, execute: async (approved) => { executions++; return approved ? { ok: true } : { ok: false, executed: false, error: 'approval required' } } })
  assert.equal(executions, 2); assert.equal(approvals, 1)
})
test('declined write response reaches the scripted model', async () => {
  let step = 0
  await runToolLoop({ messages: initial, tools: schemas(false, ['github']), signal: new AbortController().signal, onText: () => {}, generate: async (messages) => {
    if (step++ === 0) return { text: '<tool_call>{"name":"connectors_execute","arguments":{"tool":"GITHUB_CREATE_ISSUE","arguments":{}}}</tool_call>' }
    assert.match(messages.at(-1)!.content, /"declined":true/)
    return { text: 'It was not done.' }
  }, execute: async () => JSON.stringify(await runConnectorAction({ tool: 'GITHUB_CREATE_ISSUE', arguments: {}, keys: [], approve: async () => 'decline', execute: async () => { throw new Error('must not execute') } })) })
})
test('cancellation prevents model calls and tool execution', async () => {
  const ac = new AbortController(); ac.abort()
  await assert.rejects(runToolLoop({ messages: initial, tools: [], signal: ac.signal, onText: () => {}, generate: async () => { throw new Error('must not generate') }, execute: async () => { throw new Error('must not execute') } }), /abort/i)
})
test('large JSON remains parseable and bounded; context is re-budgeted each step', () => {
  const payload = { items: Array.from({ length: 400 }, () => ({ description: 'abc'.repeat(3000), nested: ['x'.repeat(10000)] })) }
  const json = boundedJSON(payload)
  assert.ok(JSON.parse(json)); assert.ok(json.length <= 4400, String(json.length))
  const turns = budgetTurns([...initial, ...Array.from({ length: 12 }, (_, i): Turn => ({ role: i % 2 ? 'user' : 'assistant', content: 'x'.repeat(4400) }))])
  const cost = turns.reduce((sum, t) => sum + Math.ceil(t.content.length / 3) + 8, 0)
  assert.ok(cost + 850 + 64 <= 4096, String(cost))
})

test('schema compaction preserves required fields, constraints, property names and literal values', () => {
  const schema = { type: 'object', title: 'Display title', properties: { title: { type: 'string', title: 'Display', maxLength: 30 }, config: { const: { title: 'Literal title', examples: [1, 2] } } }, required: ['title'], additionalProperties: false }
  assert.deepEqual(compactSchema(schema), { type: 'object', properties: { title: { type: 'string', maxLength: 30 }, config: { const: { title: 'Literal title', examples: [1, 2] } } }, required: ['title'], additionalProperties: false })
})
test('question survives large intermediate tool turns and valid tool JSON is never sliced', () => {
  const turns: Turn[] = [...initial, ...Array.from({ length: 8 }, (_, i): Turn => ({ role: i % 2 ? 'user' : 'assistant', content: i % 2 ? '<tool_response>\n' + JSON.stringify({ result: 'x'.repeat(4400) }) + '\n</tool_response>' : nativeCall }))]
  const budgeted = budgetTurns(turns)
  assert.ok(budgeted.some((t) => t.content === 'question'))
  for (const t of budgeted.filter((t) => t.content.startsWith('<tool_response>'))) assert.ok(JSON.parse(t.content.replace(/^<tool_response>|<\/tool_response>$/g, '')))
})
test('budget pins the question with whitespace and grouped native responses and rejects an oversized latest result', () => {
  const response: Turn = { role: 'user', content: '\n<tool_response>\n' + JSON.stringify({ result: 'x'.repeat(4400) }) + '\n</tool_response>' }
  const grouped = { ...response, content: response.content + '\n<tool_response>\n{}\n</tool_response>' }
  const turns = budgetTurns([...initial, ...Array.from({ length: 5 }, () => [{ role: 'assistant', content: nativeCall } as Turn, response]).flat(), grouped])
  assert.ok(turns.some((turn) => turn.content === 'question'))
  assert.equal(turns.at(-1)!.content, grouped.content)
  assert.throws(() => budgetTurns([...initial, { ...response, content: '<tool_response>\n' + 'x'.repeat(15000) + '\n</tool_response>' }]), /latest tool result/)
})
test('prefetch failures become context, allowing a final answer without invented sources', async () => {
  await runToolLoop({ messages: initial, tools: schemas(true, []), signal: new AbortController().signal, onText: () => {}, prefetch: async () => { throw new Error('Search unavailable') }, hasSources: () => false,
    generate: async (messages) => { assert.match(messages.at(-1)!.content, /Search unavailable/); assert.ok(!messages[0].content.includes('Never invent sources or claims')); return { text: 'The web is unavailable.' } }, execute: async () => '{}',
  })
})

test('model sees compact complete action schemas and successful fetched pages only', async () => {
  const { createToolRuntime } = await import('../src/engine/tools.ts')
  const original = globalThis.fetch
  let sources: { index: number; title: string; url: string }[] = []
  const runtime = createToolRuntime({ signal: new AbortController().signal, onActivity: () => {}, onSources: (s) => { sources = s }, getAllowed: () => [], approve: async () => 'decline' })
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('connectors/tools/search')) return new Response(JSON.stringify({ ok: true, items: [{ slug: 'GITHUB_LIST_REPOS', name: 'List repos', description: 'Useful action', tags: ['readOnlyHint'], toolkit: 'github', input_parameters: { type: 'object', properties: { per_page: { type: 'integer', default: 30, maximum: 100, human_parameter_description: 'x'.repeat(5000) } } } }] }))
    if (url.includes('/search?')) return new Response(JSON.stringify({ ok: true, results: [{ title: 'A', url: 'https://a.org/article', snippet: 'not read' }, { title: 'B', url: 'https://b.org/article', snippet: 'unfetched' }] }))
    if (url.includes('a.org')) return new Response(JSON.stringify({ ok: true, title: 'A fetched', text: 'page text '.repeat(3000), url: 'https://a.org/article' }))
    return new Response(JSON.stringify({ ok: false, error: 'Unreadable' }), { status: 400 })
  }
  try {
    const tools = JSON.parse(await runtime.execute({ name: 'connectors_search', arguments: { query: 'list my repos' } }))
    assert.equal(tools.items[0].input_parameters.properties.per_page.maximum, 100)
    assert.ok(!JSON.stringify(tools).includes('human_parameter_description'))
    const text = await runtime.search('news')
    assert.ok(text.length <= 3600); assert.ok(!text.includes('unfetched')); assert.equal(sources.length, 1); assert.equal(sources[0].index, 1)
  } finally { globalThis.fetch = original }
})

test('without tool results, long attachments retain the available context budget', () => {
  const request = 'x'.repeat(5000)
  const turns = budgetTurns([{ role: 'system', content: 'short system' }, { role: 'user', content: request }])
  assert.equal(turns.at(-1)!.content, request)
  const limited = budgetTurns([{ role: 'system', content: 'x'.repeat(8000) }, { role: 'user', content: 'y'.repeat(5000) }])
  assert.ok(limited.reduce((sum, t) => sum + Math.ceil(t.content.length / 3) + 8, 0) + 850 + 64 <= 4096)
})

test('search reads past failed and empty pages with bounded concurrency and stops at three successes', async (t) => {
  const results = Array.from({ length: 9 }, (_, i) => ({ title: `Result ${i}`, url: `https://site${i}.org/article`, snippet: 'Not fetched' }))
  const reads: string[] = []
  let sources: Source[] = [], active = 0, peak = 0
  const runtime = createToolRuntime({ signal: new AbortController().signal, onActivity: () => {}, onSources: (s) => { sources = s }, getAllowed: () => [], approve: async () => 'decline' })
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/search') return Response.json({ results: [results[0], { ...results[0], url: 'https://www.site0.org/duplicate' }, ...results.slice(1)] })
    const target = url.searchParams.get('url')!
    reads.push(target)
    peak = Math.max(peak, ++active)
    await new Promise((resolve) => setImmediate(resolve))
    active--
    const i = results.findIndex((r) => r.url === target)
    if (i < 2) return Response.json({ ok: false, error: i === 0 ? 'Page exceeds 3 MB' : 'HTTP 401' }, { status: 400 })
    return Response.json({ title: `Fetched ${i}`, url: target, text: i === 3 ? ' \n ' : `Facts ${i}` })
  })
  const note = await runtime.search('recent news')
  assert.deepEqual(reads, results.slice(0, 6).map((r) => r.url))
  assert.equal(peak, 3)
  assert.deepEqual(sources, [2, 4, 5].map((i, n) => ({ index: n + 1, title: `Fetched ${i}`, url: results[i].url })))
  assert.ok(note.startsWith('These are the only sources you may cite or name: [1] Fetched 2; [2] Fetched 4; [3] Fetched 5.'))
  assert.ok(!note.includes('Not fetched'))
  assert.ok(!note.includes('[4]'))
  assert.ok(note.length <= 3600)
  assert.ok(runtime.hasSources())
})

test('search stops at eight candidates or exhaustion when all pages fail', async (t) => {
  for (const count of [2, 10]) {
    const results = Array.from({ length: count }, (_, i) => ({ title: `Result ${i}`, url: `https://site${i}.org/article`, snippet: '' }))
    let reads = 0, sources: Source[] = []
    const runtime = createToolRuntime({ signal: new AbortController().signal, onActivity: () => {}, onSources: (s) => { sources = s }, getAllowed: () => [], approve: async () => 'decline' })
    const mock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      if (String(input).startsWith('/api/search?')) return Response.json({ results })
      reads++
      throw new Error('Unreadable')
    })
    try {
      assert.match(await runtime.search('recent news'), /No sources are available to cite/)
      assert.equal(reads, Math.min(count, 8))
      assert.deepEqual(sources, [])
      assert.ok(!runtime.hasSources())
    } finally { mock.mock.restore() }
  }
})

test('search cancellation prevents further candidate batches and clears activity', async (t) => {
  const controller = new AbortController(), activity: (string | undefined)[] = []
  let reads = 0, published = false
  const results = Array.from({ length: 8 }, (_, i) => ({ title: `Result ${i}`, url: `https://site${i}.org/article`, snippet: '' }))
  const runtime = createToolRuntime({ signal: controller.signal, onActivity: (s) => { activity.push(s) }, onSources: () => { published = true }, getAllowed: () => [], approve: async () => 'decline' })
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('/api/search?')) return Response.json({ results })
    assert.ok(init?.signal)
    if (++reads === 3) { controller.abort(); assert.ok(init.signal.aborted) }
    throw new Error('Unreadable')
  })
  await assert.rejects(runtime.search('recent news'), /abort/i)
  assert.equal(reads, 3)
  assert.equal(published, false)
  assert.equal(activity.at(-1), undefined)
})

const readAction: ConnectorTool = { slug: 'APP_LIST_ITEMS', name: 'List items', description: 'Read connected items', tags: ['readOnlyHint'], toolkit: 'app', input_parameters: { type: 'object', required: [] } }
const otherAction: ConnectorTool = { ...readAction, slug: 'APP_GET_PROFILE', name: 'Get profile' }
const searchCall = { name: 'connectors_search', arguments: { query: 'list items' } }

test('plain read directly executes only the top action once, returns alternatives and registers every hint', async (t) => {
  let approvals = 0
  const bodies: unknown[] = []
  const runtime = createToolRuntime({ request: 'Please LiSt my items', signal: new AbortController().signal, onActivity: () => {}, onSources: () => {}, getAllowed: () => [], approve: async () => { approvals++; return 'once' } })
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith('/search')) return Response.json({ items: [readAction, otherAction] })
    assert.equal(String(input), '/api/connectors/tools/execute')
    bodies.push(JSON.parse(String(init?.body)))
    return Response.json({ data: [{ name: 'Example', empty: null, url: 'https://example.org/item' }], successful: true, error: null, executed: true })
  })
  const response = await runtime.execute(searchCall)
  assert.deepEqual(bodies, [{ tool: readAction.slug, arguments: {}, approved: false }])
  assert.equal(approvals, 0)
  assert.ok(response.startsWith('Result of List items. State only facts present below.'))
  assert.match(response, /Executed APP_LIST_ITEMS \(List items\)/)
  assert.match(response, /- name: Example; url: https:\/\/example.org\/item/)
  assert.match(response, /other_actions: \[{"slug":"APP_GET_PROFILE","name":"Get profile"}\]/)
  assert.ok(!response.includes('input_parameters'))
  assert.ok(!response.includes('empty'))
  assert.ok(response.length <= TOOL_RESULT_CHARS)
  const second = JSON.parse(await runtime.execute(searchCall))
  assert.equal(second.ok, false)
  assert.match(second.error, /Already done: APP_LIST_ITEMS ran and its result is above/)
  assert.equal(bodies.length, 1)
  await runtime.execute({ name: 'connectors_execute', arguments: { tool: otherAction.slug, arguments: {} } })
  assert.equal(bodies.length, 2)
  assert.equal(approvals, 0)
})

test('direct execution requires a read verb, no write verb and a top read with no required inputs', async (t) => {
  const cases = [
    { request: 'delete my repo', top: readAction },
    { request: 'List items then DELETE one', top: readAction },
    { request: 'My items?', top: readAction },
    { request: 'Can you shortlist my items?', top: readAction },
    { request: 'List items', top: { ...readAction, slug: 'APP_DELETE_ITEMS', tags: ['deleteHint', 'readOnlyHint'] } },
    { request: 'List items', top: { ...readAction, input_parameters: { type: 'object', required: ['owner'], properties: { owner: { type: 'string' } } } } },
    { request: 'List items', top: undefined },
  ]
  for (const { request, top } of cases) {
    const runtime = createToolRuntime({ request, signal: new AbortController().signal, onActivity: () => {}, onSources: () => {}, getAllowed: () => [], approve: async () => { throw new Error('must not ask') } })
    const mock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      assert.equal(String(input), '/api/connectors/tools/search')
      return Response.json({ items: top ? [top, otherAction] : [] })
    })
    try {
      const response = JSON.parse(await runtime.execute(searchCall))
      assert.deepEqual(response.items.map((item: ConnectorTool) => item.slug), top ? [top.slug, otherAction.slug] : [])
      assert.equal(mock.mock.callCount(), 1)
      if (top?.input_parameters.required?.length) assert.deepEqual(response.items[0].input_parameters.required, ['owner'])
    } finally { mock.mock.restore() }
  }
})

test('direct read respects authoritative approval requirements and preserves declined/error payloads', async (t) => {
  for (const consent of ['once', 'decline'] as const) {
    let approvals = 0
    const bodies: { approved: boolean }[] = []
    const runtime = createToolRuntime({ request: 'Read items', signal: new AbortController().signal, onActivity: () => {}, onSources: () => {}, getAllowed: () => [], approve: async () => { approvals++; return consent } })
    const mock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/search')) return Response.json({ items: [readAction] })
      const body = JSON.parse(String(init?.body)); bodies.push(body)
      return Response.json(body.approved ? { data: { name: 'Example' }, successful: true } : { ok: false, executed: false, error: 'approval required' })
    })
    try {
      const response = await runtime.execute(searchCall)
      assert.equal(approvals, 1)
      assert.deepEqual(bodies.map((body) => body.approved), consent === 'once' ? [false, true] : [false])
      if (consent === 'decline') assert.equal(JSON.parse(response).declined, true)
      else assert.match(response, /name: Example/)
    } finally { mock.mock.restore() }
  }
})

test('direct read budgets a large result and a short list of alternative slugs without schemas', async (t) => {
  const runtime = createToolRuntime({ request: 'Show items', signal: new AbortController().signal, onActivity: () => {}, onSources: () => {}, getAllowed: () => [], approve: async () => { throw new Error('must not ask') } })
  const alternatives = Array.from({ length: 40 }, (_, i) => ({ ...otherAction, slug: `APP_GET_${i}_${'LONG_'.repeat(10)}ITEMS` }))
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => String(input).endsWith('/search')
    ? Response.json({ items: [readAction, ...alternatives] })
    : Response.json({ data: Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}`, description: `Item ${i} has a complete set of useful facts. `.repeat(5) })), successful: true, error: null }))
  const response = await runtime.execute(searchCall)
  assert.ok(response.length <= TOOL_RESULT_CHARS, String(response.length))
  assert.match(response, /Showing \d+ of 30 items\./)
  assert.ok(JSON.parse(response.split('\nother_actions: ')[1]).length > 0)
})

test('an announcement continues once and a second announcement becomes the final answer', async () => {
  const announcement = 'Great, I found the exact tool needed. Let me fetch your items now.'
  let generations = 0
  const visible: string[] = []
  const result = await runToolLoop({ messages: initial, tools: schemas(true, []), signal: new AbortController().signal, onText: (text) => visible.push(text),
    generate: async (messages, onText) => {
      if (generations++ === 1) {
        assert.equal(messages.at(-2)!.content, announcement)
        assert.equal(messages.at(-1)!.content, 'Continue: make the tool call now.')
        assert.ok(messages.some((message) => message.content === 'question'))
      }
      onText(announcement)
      return { text: announcement }
    }, execute: async () => { throw new Error('must not execute') },
  })
  assert.equal(generations, 2)
  assert.equal(result.text, announcement)
  assert.deepEqual(visible, [announcement, '', announcement])
})

test('one announcement followed by a call returns the actual result', async () => {
  const outputs = ["I'll look that up now.", toolCall(), 'Here is the answer.']
  let executions = 0
  const result = await runToolLoop({ messages: initial, tools: schemas(true, []), signal: new AbortController().signal, onText: () => {},
    generate: async () => ({ text: outputs.shift()! }), execute: async () => { executions++; return 'Facts' },
  })
  assert.equal(result.text, 'Here is the answer.')
  assert.equal(executions, 1)
  assert.equal(outputs.length, 0)
})

test('substantive, long or tool-less answers are not nudged', async () => {
  for (const [text, tools] of [
    ['You have 12 items. Let me know if you need details.', schemas(true, [])],
    ["I'll fetch the next page. The first page contains these items: alpha, beta.", schemas(true, [])],
    ["I'll look into it. " + 'x'.repeat(400), schemas(true, [])],
    ["I'll look into it.", []],
  ] as const) {
    let generations = 0
    const result = await runToolLoop({ messages: initial, tools: [...tools], signal: new AbortController().signal, onText: () => {},
      generate: async () => { generations++; return { text } }, execute: async () => { throw new Error('must not execute') },
    })
    assert.equal(generations, 1)
    assert.equal(result.text, text)
  }
})

test('cutoff strips tool markup and regenerates an empty answer once without executing tools', async () => {
  for (const finalOutputs of [[toolCall(), 'Facts from the tool results.'], ['', ''], ['Facts from the tool results. ' + toolCall()]]) {
    let generations = 0, executions = 0
    const outputs = Array.from({ length: 4 }, (_, i) => toolCall('web_search', { query: String(i) })).concat(finalOutputs)
    const result = await runToolLoop({ messages: initial, tools: schemas(true, []), signal: new AbortController().signal, onText: () => {},
      generate: async (messages) => {
        if (generations++ >= 4) {
          assert.ok(!messages[0].content.includes('<tools>'))
          assert.equal(messages.at(-1)!.content, 'Answer now using only the tool results above. Do not call tools.')
          assert.ok(messages.some((message) => message.content === 'question'))
          assert.ok(messages.some((message) => message.content.includes('Fetched facts')))
        }
        return { text: outputs.shift()! }
      }, execute: async () => { executions++; return 'Fetched facts' },
    })
    assert.equal(executions, 4)
    assert.equal(generations, 4 + finalOutputs.length)
    assert.equal(result.text, finalOutputs.every((text) => !text) ? 'I could not finish this request within the tool limit. Please try a narrower request.' : 'Facts from the tool results.')
  }
})

test('identical calls with reordered nested argument keys execute once while different actions still run', async () => {
  const args = [{ query: 'same', filters: { a: 1, b: [2, 3] } }, { filters: { b: [2, 3], a: 1 }, query: 'same' }, { query: 'same', filters: { a: 1, b: [3, 2] } }]
  let generations = 0, executions = 0
  const result = await runToolLoop({ messages: initial, tools: schemas(true, []), signal: new AbortController().signal, onText: () => {},
    generate: async (messages) => {
      if (generations === 2) assert.deepEqual(JSON.parse(messages.at(-1)!.content.replace(/^<tool_response>\s*|\s*<\/tool_response>$/g, '')), { ok: false, error: 'Already done; the result is above. Answer now or use a different action.' })
      return { text: generations < args.length ? `<tool_call>${JSON.stringify({ name: 'web_search', arguments: args[generations++] })}</tool_call>` : 'Answer' }
    }, execute: async () => { executions++; return 'Facts' },
  })
  assert.equal(result.text, 'Answer')
  assert.equal(executions, 2)
})

test('compaction unwraps successful data and removes empties, machine URLs, templates and deep objects', () => {
  const result = compactConnectorResult({ data: { items: [{ name: 'Example', private: false, stars: 0, language: 'TypeScript', description: 'Some\ntext', html_url: 'https://example.org/item', homepage: 'https://example.net', api: 'https://api.example.org/item', template: 'https://example.org/item{/number}', nothing: null, blank: '', whitespace: '  ', missing: undefined, emptyArray: [], emptyObject: {}, deep: { nested: { beyond: { secret: 'Drop me' } } } }] }, successful: true, error: null, executed: true }, 'List items')
  assert.ok(result.startsWith('Result of List items. State only facts present below.'))
  assert.match(result, /Total items 1, shown 1/)
  assert.match(result, /- name: Example; private: false; stars: 0; language: TypeScript; description: Some text; html_url: https:\/\/example.org\/item; homepage: https:\/\/example.net/)
  for (const unwanted of ['api.', '{/number}', 'nothing', 'blank', 'whitespace', 'missing', 'emptyArray', 'emptyObject', 'Drop me', 'successful', 'executed']) assert.ok(!result.includes(unwanted), unwanted)
})

test('compaction bounds whole items and reports exact shown and response counts', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ name: `Item-${i}`, description: `Description ${i} `.repeat(15), html_url: `https://example.org/item/${i}` }))
  const output = compactConnectorResult({ data: { items, total_count: 900 }, successful: true, error: null }, 'List items')
  const rows = output.split('\n').filter((line) => line.startsWith('- '))
  assert.ok(rows.length > 0 && rows.length < items.length)
  assert.ok(output.length <= TOOL_RESULT_CHARS)
  assert.match(output, new RegExp(`Showing ${rows.length} of 30 items\\.`))
  assert.match(output, new RegExp(`Total items 30, shown ${rows.length}`))
  assert.ok(!output.includes('of 900 items'))
  rows.forEach((row, i) => assert.equal(row, `- name: Item-${i}; description: ${items[i].description.trim()}; html_url: https://example.org/item/${i}`))
  const huge = compactConnectorResult({ data: [Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field${i}`, 'x'.repeat(10000)]))], successful: true }, 'List items')
  assert.match(huge, /Showing 0 of 1 items\./)
  assert.ok(!huge.includes('- field0:'))
  assert.ok(huge.length <= TOOL_RESULT_CHARS)
})

test('compact records allow thirty short items to fit and preserve error and control payload shapes', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}`, private: false, language: 'TS', html_url: `https://example.org/${i}`, unused: null, api: `https://api.example.org/${i}` }))
  const output = compactConnectorResult({ data: items, successful: true, error: null }, 'List items')
  assert.equal(output.split('\n').filter((line) => line.startsWith('- ')).length, 30)
  assert.match(output, /Total items 30, shown 30/)
  assert.ok(!output.includes('Showing'))
  assert.ok(output.length <= TOOL_RESULT_CHARS)
  for (const payload of [
    { ok: false, executed: false, error: 'approval required' },
    { ok: false, executed: false, declined: true, error: 'User declined' },
    { data: null, successful: false, error: 'Upstream failure' },
  ]) assert.deepEqual(JSON.parse(compactConnectorResult(payload, 'List items')), payload)
})

test('empty records do not become phantom rows or change the original item count', () => {
  const output = compactConnectorResult({ data: [null, {}, { name: 'Example', empty: { values: [] } }, []], successful: true }, 'List items')
  assert.match(output, /Total items 4, shown 1/)
  assert.match(output, /Showing 1 of 4 items\./)
  assert.equal(output.split('\n').filter((line) => line.startsWith('- ')).length, 1)
  assert.ok(!output.includes('empty'))
})

test('loop instructions preserve the question and latest result when budgeting context', () => {
  const turns = budgetTurns([...initial, { role: 'assistant', content: 'x'.repeat(3000) }, { role: 'user', content: 'Continue: make the tool call now.' }, { role: 'assistant', content: nativeCall }, { role: 'user', content: '<tool_response>\n' + 'facts '.repeat(700) + '\n</tool_response>' }, { role: 'user', content: 'Answer now using only the tool results above. Do not call tools.' }])
  assert.ok(turns.some((turn) => turn.content === 'question'))
  assert.ok(turns.some((turn) => turn.content.includes('facts ')))
  assert.throws(() => budgetTurns([...initial, { role: 'user', content: '<tool_response>\n' + 'x'.repeat(15000) + '\n</tool_response>' }, { role: 'user', content: 'Answer now using only the tool results above. Do not call tools.' }]), /latest tool result/)
})

test('lists state shared values once, use dotted nested keys, cap long text and go lean before dropping items', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: 1000 + i, name: `repo-${i}`, owner: { login: 'someone' }, archived: false, private: i % 2 === 0, stars: i % 3, description: `About repo ${i} `.repeat(10) + 'y'.repeat(400), html_url: `https://example.org/repo-${i}` }))
  const output = compactConnectorResult({ data: items, successful: true }, 'List repositories')
  assert.match(output, /^Same for every item: owner\.login: someone; archived: false$/m)
  const rows = output.split('\n').filter((line) => line.startsWith('- '))
  assert.ok(rows.length >= 10, String(rows.length))
  assert.ok(output.length <= TOOL_RESULT_CHARS)
  assert.match(output, new RegExp(`Total items 30, shown ${rows.length}`))
  for (const row of rows) {
    assert.ok(!/(?:^|; )(?:id|private|archived|owner\.login): /.test(row.slice(2)), row)
    assert.ok(!row.includes('y'.repeat(300)), 'long text is capped')
    assert.match(row, /name: repo-\d+; .*html_url: https:\/\/example\.org\/repo-\d+/)
  }
  const short = compactConnectorResult({ data: [{ id: 7, name: 'a', private: true }, { id: 8, name: 'b', private: false }], successful: true }, 'List')
  assert.match(short, /- id: 7; name: a; private: true/)
})

test('a plain read naming one connected app is searched before generation; writes and ambiguity are left to the model', () => {
  assert.equal(readTarget('list my GitHub repos', ['github', 'gmail']), 'github')
  assert.equal(readTarget('show my latest Gmail emails', ['github', 'gmail']), 'gmail')
  assert.equal(readTarget('list my GitHub repos', ['gmail']), undefined)
  assert.equal(readTarget('create a GitHub issue', ['github']), undefined)
  assert.equal(readTarget('list my repos and delete the oldest on GitHub', ['github']), undefined)
  assert.equal(readTarget('compare my GitHub repos with my Gmail', ['github', 'gmail']), undefined)
  assert.ok(plainReadIntent('list my GitHub repos'))
  assert.ok(!plainReadIntent('send an email'))
})
