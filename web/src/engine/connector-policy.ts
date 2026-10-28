/** Shared, pure port of the Mac connector action policy. Metadata wins; unknown actions need consent. */
export interface ToolHint { tags?: string[]; name?: string; toolkit?: string }
export const readVerbs = new Set('LIST GET SEARCH FETCH FIND READ RETRIEVE QUERY CHECK COUNT DESCRIBE VIEW LOOKUP SHOW DOWNLOAD'.split(' '))
export const writeVerbs = new Set('CREATE UPDATE DELETE REMOVE SEND SENDS POST PUT PATCH MERGE TRANSFER INVITE SHARE ADD EDIT MODIFY REPLY FORWARD MOVE ARCHIVE TRASH UPLOAD PUBLISH CLOSE REOPEN LOCK UNLOCK REVOKE APPROVE DISMISS CANCEL EXECUTE RUN TRIGGER DISPATCH SET ENABLE DISABLE FOLLOW UNFOLLOW STAR UNSTAR ACCEPT DECLINE MARK ASSIGN UNASSIGN RENAME COPY IMPORT SUBMIT PAY SCHEDULE INSERT REPLACE RESTORE CLEAR BLOCK UNBLOCK WATCH SUBSCRIBE UNSUBSCRIBE LABEL PIN UNPIN REACT COMMENT DRAFT FORK'.split(' '))
const tokens = (slug: string) => slug.trim().toUpperCase().split('_').filter(Boolean)
const verbIndex = (words: string[]) => words.findIndex((v, i) => i > 0 && (readVerbs.has(v) || writeVerbs.has(v)))
export function classify(slug: string, tags: string[] = []): 'read' | 'write' {
  const hints = tags.map((t) => t.toLowerCase())
  if (hints.some((t) => ['destructivehint', 'createhint', 'updatehint', 'deletehint'].includes(t))) return 'write'
  if (hints.includes('readonlyhint')) return 'read'
  for (const word of tokens(slug).slice(1)) {
    if (readVerbs.has(word)) return 'read'
    if (writeVerbs.has(word)) return 'write'
  }
  return 'write'
}
export function toolkitFrom(slug: string, metadata?: string) {
  if (metadata?.trim()) return metadata.trim().toLowerCase()
  const words = tokens(slug), i = verbIndex(words)
  return words.slice(0, i < 0 ? 1 : i).join('').toLowerCase()
}
export const alwaysAllowKey = (toolkit: string, action: string) => `${toolkit.toLowerCase()}:${action.toUpperCase()}`
export const containsAllowed = (key: string, keys: string[]) => keys.some((k) => k.toLowerCase() === key.toLowerCase())
export const addingAllowed = (key: string, keys: string[]) => containsAllowed(key, keys) ? keys : [...keys, key]
export const resetAllowed = (toolkit: string, keys: string[]) => keys.filter((k) => !k.toLowerCase().startsWith(`${toolkit.toLowerCase()}:`))
export function decision(slug: string, hint: ToolHint = {}, keys: string[] = []): 'run' | 'needsCard' {
  return classify(slug, hint.tags) === 'read' || containsAllowed(alwaysAllowKey(toolkitFrom(slug, hint.toolkit), slug), keys) ? 'run' : 'needsCard'
}
const oneLine = (value: string, limit = 80) => {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text
}
export function humanizeAction(slug: string) {
  const words = tokens(slug), i = verbIndex(words)
  let text = words.slice(i < 0 ? 1 : i).join(' ').toLowerCase().replace(/ for the authenticated user$/, '')
  text = text ? text[0].toUpperCase() + text.slice(1) : 'Run connected-app action'
  return text
}
export const actionName = (slug: string, hint?: ToolHint) => hint?.name?.trim() ? oneLine(hint.name) : humanizeAction(slug)
export const appName = (toolkit: string) => ({ github: 'GitHub', gmail: 'Gmail', googledrive: 'Google Drive' }[toolkit] ?? (toolkit ? toolkit[0].toUpperCase() + toolkit.slice(1) : 'connected app'))
export function detail(args: Record<string, unknown>) {
  const value = (key: string) => typeof args[key] === 'string' ? oneLine(args[key]) : Array.isArray(args[key]) && args[key].every((x) => typeof x === 'string') ? oneLine(args[key].join(', ')) : ''
  const repo = value('repo') || value('repository')
  return oneLine([value('owner_repo') || (repo ? [value('owner'), repo].filter(Boolean).join('/') : ''), ...['title', 'to', 'subject', 'channel'].map(value)].filter(Boolean).join(' · '), 160)
}
export function declinedPayload(action: string, app: string) {
  return { ok: false, executed: false, declined: true, error: `The user chose not to allow ${action} in ${app}. Nothing was sent. Briefly tell them it was not done.` }
}

export function parseAction(argumentsJSON?: string | null): { slug: string; arguments: Record<string, unknown> } | null {
  try {
    const root = JSON.parse(argumentsJSON ?? '')
    if (typeof root?.tool !== 'string' || !root.tool.trim()) return null
    let args = root.arguments_json
    if (typeof args === 'string') { try { args = JSON.parse(args) } catch { args = {} } }
    return { slug: root.tool.trim(), arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {} }
  } catch { return null }
}
export function actionWords(slug: string) {
  const words = tokens(slug), i = verbIndex(words)
  return words.slice(i < 0 ? 1 : i)
}
export const alwaysAllowKeyFor = (slug: string) => alwaysAllowKey(toolkitFrom(slug), slug)
export const allowedKeys = (toolkit: string, keys: string[]) => keys.filter((k) => k.toLowerCase().startsWith(`${toolkit.toLowerCase()}:`))
export function descriptionLine(slug: string, argumentsJSON?: string | null) {
  return [humanizeAction(slug), detail(parseAction(argumentsJSON)?.arguments ?? {})].filter(Boolean).join(' · ')
}
