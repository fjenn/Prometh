import { app, load, ui } from './state/store'
import { prepOrder } from './engine/catalog'
import { probe } from './engine/device'
import { activeLLM, resumePrep, verifyPrepared } from './engine/prep'
import { warmLLM } from './engine/llm'

/**
 * One tab at a time owns the GPU models and the saved state (a second tab would
 * overwrite chats and load the models twice). The other tab shows "open elsewhere".
 */
export function claimTab(steal: boolean) {
  if (!navigator.locks) return void start()
  navigator.locks
    .request('prometh-tab', steal ? { steal: true } : { ifAvailable: true }, (lock) => {
      if (!lock) {
        ui.set({ otherTab: true })
        return
      }
      if (steal) app.set(load())
      ui.set({ otherTab: false })
      void start()
      return new Promise<void>(() => {}) // hold the lock while this tab lives
    })
    // Another tab took over: reload so this one stops its models and shows the notice.
    .catch(() => location.reload())
}

async function start() {
  const d = await probe()
  if (!d.webgpu) return
  await verifyPrepared()
  const s = app.get()
  if (s.onboardingComplete || s.step === 3) for (const k of prepOrder(s)) if (s.preps[k]?.status === 'queued') resumePrep(k)
  // Warm up the model the open chat uses, so the first message answers quickly.
  if (s.onboardingComplete) {
    const chat = s.chats.find((c) => c.id === s.selectedChatId)
    const key = chat?.mode === 'evil' ? 'evil' : 'chat'
    const m = activeLLM(key)
    if (m && app.get().preps[key]?.status === 'ready') {
      // The composer waits for this (a message sent mid-warm-up would only wait longer).
      ui.set({ warming: m.label })
      // Never lock the input for long: a stuck warm-up just stops blocking after 45 s.
      Promise.race([warmLLM(m).catch(() => undefined), new Promise((r) => setTimeout(r, 45000))]).finally(() => ui.set({ warming: null }))
    }
  }
}

