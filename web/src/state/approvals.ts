import { app, uid, updateMessage } from './store'
import { actionName, addingAllowed, alwaysAllowKey, appName, detail, toolkitFrom } from '../engine/connector-policy'
import { cachedCatalog } from '../engine/api'
import type { ApprovalRequest, Consent } from '../engine/tools'

const waiting = new Map<string, (choice: Consent) => void>()
/** The model has no access to this resolver. Only explicit chat-card buttons call it. */
export function resolveApproval(chat: string, message: string, id: string, choice: Consent) {
  const msg = app.get().chats.find((c) => c.id === chat)?.messages.find((m) => m.id === message)
  if (!waiting.has(id) || msg?.approval?.id !== id || msg.approval.resolution) return
  if (choice === 'always') app.set((s) => ({ alwaysAllowed: addingAllowed(alwaysAllowKey(msg.approval!.toolkit, msg.approval!.tool), s.alwaysAllowed) }))
  updateMessage(chat, message, (m) => ({ ...m, approval: m.approval && { ...m.approval, resolution: choice } }))
  waiting.get(id)?.(choice)
}
export function requestApproval(chat: string, message: string, request: ApprovalRequest, signal: AbortSignal): Promise<Consent> {
  signal.throwIfAborted()
  const id = uid(), toolkit = toolkitFrom(request.tool, request.hint?.toolkit)
  const catalog = cachedCatalog()?.items.find((v) => v.slug === toolkit)
  updateMessage(chat, message, (m) => ({ ...m, toolActivity: undefined, approval: { id, tool: request.tool, arguments: request.arguments, toolkit, name: catalog?.name || appName(toolkit), action: actionName(request.tool, request.hint), logo: catalog?.logo, detail: detail(request.arguments) } }))
  return new Promise((resolve, reject) => {
    const cleanup = () => { waiting.delete(id); signal.removeEventListener('abort', abort) }
    const abort = () => {
      cleanup()
      updateMessage(chat, message, (m) => ({ ...m, approval: m.approval && { ...m.approval, resolution: 'cancelled' } }))
      reject(new DOMException('Stopped', 'AbortError'))
    }
    waiting.set(id, (choice) => { cleanup(); resolve(choice) })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
export { actionName }
