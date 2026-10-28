import { jsonrepair } from 'jsonrepair'
import { api } from './api.ts'
import type { ConnectorTool } from './api.ts'
import { actionName, appName, classify, decision, declinedPayload, readVerbs, toolkitFrom, writeVerbs } from './connector-policy.ts'
import { citationRules, indexedHits, preferDistinctDomains, promptNote } from './search.ts'
import type { Source, SearchResult } from './search.ts'

export interface Turn { role: 'system' | 'assistant' | 'user'; content: string }
export interface ToolCall { name: string; arguments: Record<string, unknown> }
export interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
export type Consent = 'once' | 'always' | 'decline'
export interface ApprovalRequest { tool: string; arguments: Record<string, unknown>; hint?: ConnectorTool }
export const TOOL_RESULT_CHARS = 4400
export const schemas = (search: boolean, connected: string[]): ToolSchema[] => [
  ...(search ? [{ name: 'web_search', description: 'Search the web and read up to three pages.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] : []),
  ...(connected.length ? [
    { name: 'connectors_search', description: `To act in connected apps (${connected.join(', ')}), first search with a short query for action slugs and input schemas, then call connectors_execute. The backend knows the connected user, so do not ask for usernames or IDs implied by the connected account.`, parameters: { type: 'object', properties: { query: { type: 'string' }, toolkit: { type: 'string' } }, required: ['query'] } },
    { name: 'connectors_execute', description: 'After connectors_search, run the exact returned action slug with arguments matching its input schema. The backend supplies the connected user identity and the app handles consent.', parameters: { type: 'object', properties: { tool: { type: 'string' }, arguments: { type: 'object' } }, required: ['tool', 'arguments'] } },
  ] : []),
]
export function toolsBlock(tools: ToolSchema[]) {
  // Verbatim instructions from Qwen/Qwen3.5-9B's chat_template.jinja.
  return tools.length ? '# Tools\n\nYou have access to the following functions:\n\n<tools>\n' + tools.map((t) => JSON.stringify({ type: 'function', function: t })).join('\n') + '\n</tools>\n\nIf you choose to call a function ONLY reply in the following format with NO suffix:\n\n<tool_call>\n<function=example_function_name>\n<parameter=example_parameter_1>\nvalue_1\n</parameter>\n<parameter=example_parameter_2>\nThis is the value for the second parameter\nthat can span\nmultiple lines\n</parameter>\n</function>\n</tool_call>\n\n<IMPORTANT>\nReminder:\n- Function calls MUST follow the specified format: an inner <function=...></function> block must be nested within <tool_call></tool_call> XML tags\n- Required parameters MUST be specified\n- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after\n- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls\n</IMPORTANT>' : ''
}
/** Hide complete protocol blocks and an opening tag still arriving token by token. */
export function hideToolMarkup(text: string) {
  const visible = text.replace(/<(?:tool_(?:call|response)\b|function=|parameter=)[\s\S]*$/i, '')
  const start = visible.lastIndexOf('<')
  if (start >= 0 && ['<tool_call>', '</tool_call>', '<tool_response>', '</tool_response>', '<function=', '</function>', '<parameter=', '</parameter>'].some((tag) => tag.startsWith(visible.slice(start).toLowerCase()))) return visible.slice(0, start)
  return visible
}
export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = []
  for (const match of text.matchAll(/<tool_call>\s*([\s\S]*?)(?:<\/tool_call>|$)/gi)) {
    try {
      const raw = match[1].replace(/^```(?:json)?\s*|\s*```$/g, '')
      const fn = raw.trim().match(/^<function=([^\s<>]+)>\s*([\s\S]*?)<\/function>$/i)
      if (fn) {
        const parameters: [string, unknown][] = []
        let end = 0
        for (const parameter of fn[2].matchAll(/<parameter=([^\s<>]+)>([\s\S]*?)<\/parameter>/gi)) {
          if (fn[2].slice(end, parameter.index).trim()) throw new Error('Invalid parameter block')
          const text = parameter[2].trim()
          let value: unknown = text
          if (/^(?:\{|\[|")/.test(text) || /^(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null)$/i.test(text)) {
            try { value = JSON.parse(jsonrepair(text)) } catch { /* Keep non-JSON parameter values as raw strings. */ }
          }
          parameters.push([parameter[1], value])
          end = parameter.index + parameter[0].length
        }
        if (fn[2].slice(end).trim()) throw new Error('Invalid parameter block')
        calls.push({ name: fn[1], arguments: Object.fromEntries(parameters) })
        continue
      }
      const value = JSON.parse(jsonrepair(raw))
      const args = typeof value.arguments === 'string' ? JSON.parse(jsonrepair(value.arguments)) : value.arguments
      if (typeof value.name === 'string' && args && typeof args === 'object' && !Array.isArray(args)) calls.push({ name: value.name, arguments: args })
    } catch { /* An invalid call is handled as an error response, never executed. */ }
  }
  return calls
}
function renderToolCall(call: ToolCall) {
  const parameters = Object.entries(call.arguments).map(([name, value]) => `<parameter=${name}>\n${value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)}\n</parameter>\n`).join('')
  return `<tool_call>\n<function=${call.name}>\n${parameters}</function>\n</tool_call>`
}
const isToolResponse = (turn: Turn) => turn.role === 'user' && /^<tool_response(?:\s|>)/.test(turn.content.trimStart())
function appendToolResponse(turns: Turn[], response: string) {
  const content = `<tool_response>\n${response.trim()}\n</tool_response>`
  const previous = turns.at(-1)!
  if (isToolResponse(previous)) previous.content += '\n' + content
  else turns.push({ role: 'user', content })
}
/** Compact valid JSON, never a string sliced through JSON syntax. Schemas are returned one at a time if large. */
export function boundedJSON(value: unknown, maxChars = TOOL_RESULT_CHARS): string {
  const original = JSON.stringify(value) ?? 'null'
  if (original.length <= maxChars) return original
  let remaining = maxChars - 250, omitted = 0
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const n = Math.min(remaining, 1000)
      const result = v.length > n ? v.slice(0, Math.max(0, n - 1)) + '…' : v
      remaining -= JSON.stringify(result).length
      return result
    }
    if (Array.isArray(v)) {
      const out = []
      for (const x of v) { if (remaining < 100) { omitted++; continue }; remaining -= 2; out.push(walk(x)) }
      return out
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) { if (remaining < k.length + 100) { omitted++; continue }; remaining -= JSON.stringify(k).length + 2; out[k] = walk(x) }
      return out
    }
    remaining -= JSON.stringify(v)?.length ?? 4
    return v
  }
  return JSON.stringify({ result: walk(value), _note: `${omitted} fields/items omitted to fit context` })
}
/** Successful connector data is prose, bounded at complete fields/items rather than JSON slices. */
export function compactConnectorResult(result: Record<string, unknown>, name: string, maxChars = TOOL_RESULT_CHARS): string {
  // Preserve control/error payloads verbatim: consent handling and the model rely on their shape.
  if (result.ok === false || result.successful === false || result.executed === false || result.error) return boundedJSON(result, maxChars)
  const clean = (value: unknown, depth = 0): unknown => {
    if (value == null || value === '') return undefined
    if (typeof value === 'string') {
      if (/https?:\/\/\S+/i.test(value) && value.includes('{') && value.includes('}')) return undefined
      try { if (new URL(value).hostname.toLowerCase().startsWith('api.')) return undefined } catch { /* ordinary text */ }
      const text = value.replace(/\s+/g, ' ').trim()
      return text.length > 300 ? text.slice(0, 299) + '…' : text || undefined
    }
    if (typeof value !== 'object') return value
    if (depth > 3) return undefined
    if (Array.isArray(value)) {
      const items = value.map((item) => clean(item, depth + 1))
      // Keep positions for truthful counts even when an empty item has no displayable facts.
      return items.some((item) => item !== undefined) ? items : undefined
    }
    const entries = Object.entries(value).map(([key, item]) => [key, clean(item, depth + 1)] as const)
      .filter(([, item]) => item !== undefined && !(Array.isArray(item) && !item.length))
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  const data = 'data' in result && 'successful' in result ? result.data : result
  const value = clean(data)
  // Nested fields read as dotted keys ("owner.login: x") so values are never ambiguous.
  const flatten = (item: unknown, prefix = '', out: Record<string, string> = {}) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) for (const [key, val] of Object.entries(item)) flatten(val, prefix ? `${prefix}.${key}` : key, out)
    else if (item !== undefined) out[prefix] = Array.isArray(item) ? item.filter((v) => v !== undefined).map((v) => v && typeof v === 'object' ? inline(v) : String(v)).join(', ') : String(item)
    return out
  }
  const fields = (flat: Record<string, string>) => Object.entries(flat).map(([key, val]) => key ? `${key}: ${val}` : val).join('; ')
  const inline = (item: unknown): string => fields(flatten(item))
  const lines = [`Result of ${name}. State only facts present below.`]
  const add = (line: string, reserved = 0) => {
    if (lines.join('\n').length + line.length + 1 + reserved > maxChars) return false
    lines.push(line)
    return true
  }
  const render = (item: unknown, path = '') => {
    if (Array.isArray(item)) {
      const present = item.filter((entry) => entry !== undefined), flat = present.map((entry) => flatten(entry))
      // Values shared by every item are stated once, leaving room for more items and less to misread.
      const common = present.length > 1 && present.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
        ? Object.keys(flat[0]).filter((key) => key && flat.every((f) => f[key] === flat[0][key])) : []
      const row = (f: Record<string, string>, lean: boolean) => '- ' + fields(Object.fromEntries(Object.entries(f).filter(([key, val]) => !common.includes(key)
        // When a list overflows, drop per-item flags, zero counts and numeric internal ids before dropping whole items.
        && !(lean && (val === 'true' || val === 'false' || val === '0' || (/(?:^|[._])id$/i.test(key) && /^\d+$/.test(val)))))))
      const full = flat.map((f) => row(f, false))
      const rows = full.join('\n').length + lines.join('\n').length + 200 > maxChars ? flat.map((f) => row(f, true)) : full
      let shown = 0
      const header = lines.length
      // Reserve the widest possible count footer before adding any complete row.
      const footer = `Showing ${item.length} of ${item.length} items.`
      if (!add(`${path ? path + ': ' : ''}Total items ${item.length}, shown 0`, footer.length + 1)) return
      if (common.length && !add('Same for every item: ' + fields(Object.fromEntries(common.map((key) => [key, flat[0][key]]))), footer.length + 1)) return
      for (const row of rows) {
        const nextHeader = `${path ? path + ': ' : ''}Total items ${item.length}, shown ${shown + 1}`
        if (!add(row, footer.length + 1 + nextHeader.length - lines[header].length)) break
        lines[header] = nextHeader
        shown++
      }
      if (shown < item.length) add(`Showing ${shown} of ${item.length} items.`)
    } else if (item && typeof item === 'object') {
      for (const [key, val] of Object.entries(item)) render(val, path ? `${path}.${key}` : key)
    } else if (item !== undefined) add(path ? `${path}: ${inline(item)}` : inline(item))
  }
  render(value)
  return lines.join('\n')
}
const CONTINUE_TOOLS = 'Continue: make the tool call now.'
const ANSWER_NOW = 'Answer now using only the tool results above. Do not call tools.'
const isLoopInstruction = (turn: Turn) => turn.role === 'user' && [CONTINUE_TOOLS, ANSWER_NOW].includes(turn.content)
// Only an announcement, optionally preceded by an acknowledgement/found-tool sentence.
// Numbers, lists, or further sentences may contain an answer, so leave those alone.
const announcesAction = (text: string) => text.length < 400 && !/[\n\d]/.test(text) && /^(?:(?:great|sure|okay|ok)[,!.:\s]+)?(?:i (?:found|have found) [^.!?]+[.!]\s*)?(?:let me|i'll|i will|i'm going to|now i'll|one moment)\b[^.!?]*[.!]?$/i.test(text)
const tokens = (s: string) => Math.ceil(s.length / 3.0) + 8
/** Re-budget every step, reserving space for generation; keep the latest user request and latest result. */
export function budgetTurns(turns: Turn[], reserve = 850): Turn[] {
  const system = turns[0]
  let budget = 4096 - reserve - tokens(system.content) - 64
  if (budget < 300) throw new Error('Enabled skills and tools exceed the model context. Shorten your skills and try again.')
  // Pin the actual question even after several large responses have displaced older history.
  let question = -1
  for (let i = turns.length - 1; i > 0; i--) if (turns[i].role === 'user' && !isToolResponse(turns[i]) && !isLoopInstruction(turns[i])) { question = i; break }
  const latestResult = turns.findLastIndex(isToolResponse)
  const hasToolResults = turns.some(isToolResponse)
  const pinned = question >= 0 ? { ...turns[question], content: turns[question].content.slice(-Math.min(hasToolResults ? 2400 : Infinity, Math.max(1, (budget - 80) * 3))) } : null
  if (pinned) budget -= tokens(pinned.content)
  const history: { index: number; turn: Turn }[] = []
  if (pinned) history.push({ index: question, turn: pinned })
  for (let i = turns.length - 1; i > 0; i--) {
    if (i === question) continue
    const turn = turns[i]
    const cost = tokens(turn.content)
    if (cost > budget) {
      // Never cut through tool JSON; if the latest result cannot fit, explain how to recover.
      if (i === latestResult) throw new Error('The latest tool result and enabled skills exceed the model context. Shorten your skills and try again.')
      continue
    }
    history.push({ index: i, turn }); budget -= cost
    if (budget < 80) break
  }
  history.sort((a, b) => a.index - b.index)
  return [system, ...history.map((h) => h.turn)]
}
export async function runToolLoop(options: {
  messages: Turn[]; tools: ToolSchema[]; signal: AbortSignal
  generate: (messages: Turn[], onText: (text: string) => void) => Promise<{ text: string; stopped?: boolean; tps?: number }>
  execute: (call: ToolCall) => Promise<string>
  onText: (text: string) => void
  hasSources?: () => boolean
  reserveTokens?: number
  prefetch?: () => Promise<string>
}) {
  const turns = options.messages.map((m) => ({ ...m }))
  const base = turns[0].content
  let nudged = false
  const executed = new Set<string>()
  // Object key order is irrelevant to JSON equality; array order remains significant.
  const canonicalJSON = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)
  if (options.prefetch) {
    let result: string
    try { result = await options.prefetch() } catch (error) {
      options.signal.throwIfAborted()
      result = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Web search failed.' })
    }
    appendToolResponse(turns, result)
  }
  for (let step = 0; step <= 4; step++) {
    options.signal.throwIfAborted()
    const tools = step < 4 ? options.tools : []
    const system = base + (options.hasSources?.() ? '\n\n' + citationRules : '')
    turns[0] = { role: 'system', content: tools.length ? toolsBlock(tools) + (system.trim() ? '\n\n' + system.trim() : '') : system }
    if (step === 4) turns.push({ role: 'user', content: ANSWER_NOW })
    const result = await options.generate(budgetTurns(turns, options.reserveTokens ?? 850), (text) => options.onText(hideToolMarkup(text)))
    if (result.stopped || options.signal.aborted) return { ...result, text: hideToolMarkup(result.text) }
    const calls = parseToolCalls(result.text)
    if (step === 4) {
      const text = hideToolMarkup(result.text).trim()
      if (text) return { ...result, text }
      turns.push({ role: 'assistant', content: result.text }, { role: 'user', content: ANSWER_NOW })
      options.onText('')
      options.signal.throwIfAborted()
      const retry = await options.generate(budgetTurns(turns, options.reserveTokens ?? 850), (text) => options.onText(hideToolMarkup(text)))
      const visible = hideToolMarkup(retry.text).trim()
      return { ...retry, text: retry.stopped || options.signal.aborted ? visible : visible || 'I could not finish this request within the tool limit. Please try a narrower request.' }
    }
    if (!calls.length && tools.length && !nudged && announcesAction(hideToolMarkup(result.text).trim()) && !/<tool_call>/i.test(result.text)) {
      nudged = true
      turns.push({ role: 'assistant', content: result.text }, { role: 'user', content: CONTINUE_TOOLS })
      options.onText('')
      continue
    }
    if (!calls.length && !/<tool_call>/i.test(result.text)) return { ...result, text: hideToolMarkup(result.text) }
    // One action per step avoids parallel writes and keeps consent tied to one visible card.
    const call = calls[0]
    let response = '{"ok":false,"error":"Invalid tool call. Nest a function block with required parameter blocks inside tool_call."}'
    if (call) {
      if (!tools.some((t) => t.name === call.name)) response = '{"ok":false,"error":"Tool is unavailable."}'
      else {
        const key = canonicalJSON(call)
        if (executed.has(key)) response = '{"ok":false,"error":"Already done; the result is above. Answer now or use a different action."}'
        else try { executed.add(key); response = await options.execute(call) } catch (error) {
          options.signal.throwIfAborted()
          response = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Tool failed.' })
        }
      }
    }
    turns.push({ role: 'assistant', content: call ? renderToolCall(call) : result.text.trim() })
    appendToolResponse(turns, response)
    options.onText('')
  }
  throw new Error('Tool loop did not finish.')
}
export async function runConnectorAction(options: {
  tool: string; arguments: Record<string, unknown>; hint?: ConnectorTool; keys: string[]
  approve: (request: ApprovalRequest) => Promise<Consent>
  execute: (approved: boolean) => Promise<Record<string, unknown>>
}) {
  const { tool, hint } = options
  const consent = async () => (await options.approve({ tool, arguments: options.arguments, hint })) !== 'decline'
  const declined = () => declinedPayload(actionName(tool, hint), appName(toolkitFrom(tool, hint?.toolkit)))
  let approved = classify(tool, hint?.tags) === 'write' && decision(tool, hint, options.keys) === 'run'
  // Read actions need no approval; explicit approval is only sent for allowed write actions.
  if (decision(tool, hint, options.keys) === 'needsCard') { if (!await consent()) return declined(); approved = true }
  let result = await options.execute(approved)
  if (result.executed === false && result.error === 'approval required') {
    if (!await consent()) return declined()
    result = await options.execute(true)
  }
  return result
}
/** Remove display annotations while retaining every schema constraint and property. */
export function compactSchema(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const maps = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
  const children = ['items', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else', 'contentSchema']
  const lists = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['title', 'examples', 'human_parameter_name', 'human_parameter_description'].includes(key)).map(([key, val]) => {
    if (key === 'description' && typeof val === 'string') return [key, val.slice(0, 180)]
    if (maps.includes(key) && val && typeof val === 'object') return [key, Object.fromEntries(Object.entries(val).map(([k, v]) => [k, compactSchema(v)]))]
    if (children.includes(key)) return [key, Array.isArray(val) ? val.map(compactSchema) : compactSchema(val)]
    if (lists.includes(key) && Array.isArray(val)) return [key, val.map(compactSchema)]
    return [key, val]
  }))
}
/** A request that only reads (e.g. "list my repos"): at least one read verb and no write verb. */
export function plainReadIntent(request: string) {
  const words = request.toUpperCase().match(/\b[A-Z]+\b/g) ?? []
  return words.some((word) => readVerbs.has(word)) && !words.some((word) => writeVerbs.has(word))
}
/** The connected app a plain read names, so its catalog search can run before generation instead of relying on the model to start it. */
export function readTarget(request: string, connected: string[]) {
  if (!plainReadIntent(request)) return undefined
  const words = new Set(request.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  const named = connected.filter((slug) => words.has(slug.toLowerCase()) || words.has(appName(slug).toLowerCase()))
  return named.length === 1 ? named[0] : undefined
}
export function createToolRuntime(options: {
  signal: AbortSignal; onActivity: (text?: string) => void; onSources: (sources: Source[]) => void
  getAllowed: () => string[]; approve: (request: ApprovalRequest) => Promise<Consent>
  request?: string
}) {
  const sources: Source[] = [], hints = new Map<string, ConnectorTool>()
  let autoExecuted = false
  const plainRead = plainReadIntent(options.request ?? '')
  const runAction = async (tool: string, args: Record<string, unknown>, hint: ConnectorTool) => {
    options.onActivity(`Using ${appName(toolkitFrom(tool, hint.toolkit))}…`)
    return runConnectorAction({ tool, arguments: args, hint, keys: options.getAllowed(), approve: options.approve,
      execute: async (approved) => {
        options.onActivity(`Using ${appName(toolkitFrom(tool, hint.toolkit))}…`)
        // Approval-required is data, so the UI can retry after user consent.
        const response = await fetch('/api/connectors/tools/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, arguments: args, approved }), signal: options.signal })
        return response.json()
      },
    })
  }
  const search = async (query: string) => {
    options.onActivity('Searching the web…')
    try {
      const data = await api<{ results: SearchResult[] }>('search?q=' + encodeURIComponent(query.slice(0, 300)), undefined, options.signal)
      const selected = preferDistinctDomains(data.results, 8)
      const pages = new Map<string, { title: string; url: string; text: string }>()
      for (let start = 0; start < selected.length && pages.size < 3;) {
        options.signal.throwIfAborted()
        const batch = selected.slice(start, start + 3 - pages.size)
        start += batch.length
        options.onActivity(`Reading ${batch.length} pages…`)
        await Promise.all(batch.map(async (hit) => {
          try {
            const page = await api<{ title: string; url: string; text: string }>('read?url=' + encodeURIComponent(hit.url), undefined, options.signal)
            if (page.text.trim()) pages.set(hit.url, page)
          } catch { /* unread pages are never numbered */ }
        }))
      }
      options.signal.throwIfAborted()
      const hits = indexedHits(selected, pages, sources.length)
      sources.push(...hits.map(({ index, title, url }) => ({ index, title, url })))
      options.onSources([...sources])
      return promptNote(hits)
    } finally { options.onActivity(undefined) }
  }
  const execute = async (call: ToolCall) => {
    options.signal.throwIfAborted()
    const args = call.arguments
    try {
      if (call.name === 'web_search') return search(String(args.query ?? ''))
      if (call.name === 'connectors_search') {
        options.onActivity('Finding connected-app actions…')
        const result = await api<{ items: ConnectorTool[] }>('connectors/tools/search', args, options.signal)
        for (const item of result.items) hints.set(item.slug.toUpperCase(), item)
        const top = result.items[0]
        if (plainRead && !autoExecuted && top && classify(top.slug, top.tags) === 'read' && (!Array.isArray(top.input_parameters.required) || top.input_parameters.required.length === 0)) {
          autoExecuted = true
          const tool = top.slug.toUpperCase(), name = actionName(tool, top)
          const otherActions: { slug: string; name: string }[] = []
          for (const item of result.items.slice(1)) {
            const action = { slug: item.slug, name: actionName(item.slug, item) }
            if (JSON.stringify([...otherActions, action]).length > 1000) break
            otherActions.push(action)
          }
          // Reserve space for the alternatives; all hints remain registered, including omitted schemas.
          const suffix = '\nother_actions: ' + JSON.stringify(otherActions)
          const executed = await runAction(tool, {}, top)
          // Error/approval payloads retain the same shape as explicit execution.
          if (executed.ok === false || (executed as Record<string, unknown>).successful === false || executed.executed === false || executed.error) return compactConnectorResult(executed, name)
          const execution = `\nExecuted ${tool} (${name}).`
          return compactConnectorResult(executed, name, TOOL_RESULT_CHARS - execution.length - suffix.length) + execution + suffix
        }
        // Keep complete schemas. A large schema is explicitly rejected instead of silently losing required fields.
        const items: ConnectorTool[] = []
        for (const raw of result.items) {
          const item = { ...raw, description: raw.description.slice(0, 200), input_parameters: compactSchema(raw.input_parameters) as Record<string, unknown> }
          if (JSON.stringify([...items, item]).length < TOOL_RESULT_CHARS - 200) items.push(item)
        }
        return JSON.stringify({ ok: true, items, ...(items.length < result.items.length ? { note: 'Some action schemas exceeded context. Narrow your search.' } : {}) })
      }
      const tool = String(args.tool ?? '').trim().toUpperCase()
      if (!/^[A-Z0-9_]+$/.test(tool) || !args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments)) return '{"ok":false,"executed":false,"error":"Invalid tool or arguments"}'
      const hint = hints.get(tool)
      if (hint === undefined) return '{"ok":false,"executed":false,"error":"Unknown action slug. Use an exact slug returned by connectors_search, or search again."}'
      const result = await runAction(tool, args.arguments as Record<string, unknown>, hint)
      return compactConnectorResult(result, actionName(tool, hint))
    } finally { options.onActivity(undefined) }
  }
  return { search, execute, hasSources: () => sources.length > 0 }
}
