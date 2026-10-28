import { useEffect, useState } from 'react'
import { app, ui, useApp, useUI, uid, type SettingsTab } from '../state/store'
import type { Capability, Skill } from '../state/types'
import { CAPABILITIES } from '../state/types'
import { IMAGE_BEST, availability, capCopy, evilAvailability, modelFor } from '../engine/catalog'
import { deviceSummary, gpuName, probe, useDevice } from '../engine/device'
import { activeModel } from '../engine/prep'
import { addCapability, cancelUpgrade, deleteDownloads, deleteSkill, exportChat, importSkill, removeCapability, resetData, restartOnboarding, saveSkill, setImageModel, setSkillEnabled, upgradeChat } from '../state/actions'
import { Icon, IconButton } from './Icon'
import { Confirm, Sheet } from './Overlay'
import { Brand, PrepRow } from './Onboarding'
import { api, getCatalog, getConnections, getHealth, type ConnectionStatus, type Toolkit } from '../engine/api'
import { resetAllowed } from '../engine/connector-policy'

const TABS: SettingsTab[] = ['Appearance', 'Capabilities', 'Turbo', 'Customize', 'Privacy & data']

export function Settings() {
  const tab = useUI((s) => s.settingsTab)
  const close = () => ui.set({ settingsOpen: false })
  return (
    <Sheet onClose={close} className="settings" label="Settings">
      <nav>
        <Brand small />
        {TABS.map((t) => (
          <div key={t} style={{ display: 'contents' }}>
            {t === 'Privacy & data' && <hr />}
            <button className={tab === t ? 'on' : ''} onClick={() => ui.set({ settingsTab: t })}>
              {t === 'Turbo' && <Icon name="bolt" size={14} />}
              {t}
            </button>
          </div>
        ))}
        <span className="saved">Saved in this browser</span>
      </nav>
      <section className="pane">
        <header>
          <h2>{tab}</h2>
          <IconButton icon="x" title="Close settings" onClick={close} />
        </header>
        <div className="scroll">{tab === 'Appearance' ? <Appearance /> : tab === 'Capabilities' ? <Capabilities /> : tab === 'Turbo' ? <Turbo /> : tab === 'Customize' ? <CustomizeBody /> : <Privacy />}</div>
      </section>
    </Sheet>
  )
}

function Appearance() {
  const appearance = useApp((s) => s.appearance)
  const sample = (dark: boolean) => (
    <div style={{ flex: 1, height: 130, borderRadius: 15, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: dark ? '#22252b' : '#f8f7f4', boxShadow: '0 0 0 1px var(--hair)' }}>
      <div style={{ width: 44, height: 12, borderRadius: 3, background: dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.07)' }} />
      <div style={{ height: 28, borderRadius: 8, background: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)' }} />
    </div>
  )
  return (
    <>
      <div className="muted">Choose your preferred appearance.</div>
      <div className="seg" role="radiogroup" aria-label="Appearance">
        {(['Light', 'Dark', 'System'] as const).map((a) => (
          <button key={a} role="radio" aria-checked={appearance === a} className={appearance === a ? 'on' : ''} onClick={() => app.set({ appearance: a })}>
            {a}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14 }}>
        {sample(false)}
        {sample(true)}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        Evil Mode has its own accent in each chat, independent of appearance.
      </div>
    </>
  )
}

const VOICES: [string, string][] = [
  ['af_heart', 'Heart (US)'],
  ['af_bella', 'Bella (US)'],
  ['af_nicole', 'Nicole (US)'],
  ['bf_emma', 'Emma (UK)'],
  ['am_michael', 'Michael (US)'],
  ['bm_george', 'George (UK)'],
]

function Capabilities() {
  const d = useDevice()
  const s = useApp((x) => x)
  const total = s.selected.reduce((sum, c) => sum + (activeModel(c)?.sizeGB ?? 0), 0) + (s.evilEnabled ? (activeModel('evil')?.sizeGB ?? 0) : 0)
  const ev = evilAvailability(d)
  const chat = activeModel('chat')
  const better = d ? modelFor('chat', d) : null
  const canUpgrade = !!(chat && better && better.id !== chat.id && better.vramMB > chat.vramMB)
  const upgrade = useUI((x) => x.upgrade)
  return (
    <>
      <div className="muted" style={{ fontSize: 12 }}>
        {d ? deviceSummary(d) : 'Checking your device…'}
      </div>
      <div style={{ fontWeight: 600 }}>{total.toFixed(1)} GB selected</div>
      {CAPABILITIES.map((c) => (
        <CapTile key={c} c={c} />
      ))}
      <div className="tile">
        {s.evilEnabled ? (
          <>
            <PrepRow k="evil" />
            <div className="muted" style={{ fontSize: 12 }}>
              {activeModel('evil')?.label}. Chats in Evil Mode use it; Safe Mode chats keep the regular model.
            </div>
          </>
        ) : (
          <div className="row" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>Evil Mode</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {ev.ok ? 'An uncensored model for chats you switch to Evil Mode. 18+.' : ev.reason}
              </div>
            </div>
            <button className="btn btn-bordered" disabled={!ev.ok} onClick={() => ui.set({ settingsOpen: false, revealInChat: true })}>
              Enable…
            </button>
          </div>
        )}
      </div>
      {canUpgrade && better?.engine === 'webllm' && (
        <div className="tile" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Icon name="bolt" />
          <div style={{ flex: 1, fontSize: 13 }}>
            {upgrade ? (
              <>
                Downloading <b>{better.label}</b> · {Math.round(upgrade.progress * 100)}%. Your current model keeps answering until it’s done.
                <div className="bar">
                  <i style={{ width: `${upgrade.progress * 100}%`, background: 'var(--tint)' }} />
                </div>
              </>
            ) : (
              <>
                A bigger chat model fits this device now: <b>{better.label}</b> ({better.sizeGB.toFixed(1)} GB).
              </>
            )}
          </div>
          {upgrade ? (
            <button className="btn btn-bordered" onClick={cancelUpgrade}>
              Cancel
            </button>
          ) : (
            <button className="btn btn-bordered" onClick={() => void upgradeChat(better)}>
              Upgrade
            </button>
          )}
        </div>
      )}
      <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
        Models download once from Hugging Face and stay in this browser’s storage. Chat generation stays on this device; enabled web and plugin tools send their requests to the backend.
      </div>
    </>
  )
}

function CapTile({ c }: { c: Capability }) {
  const d = useDevice()
  const selected = useApp((s) => s.selected.includes(c))
  const voiceName = useApp((s) => s.voiceName)
  const a = d ? availability(c, d) : { ok: false, short: '', reason: 'Checking…' }
  const m = activeModel(c)
  return (
    <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {selected && a.ok ? (
        <>
          <PrepRow k={c} />
          <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {m ? `${m.label} · ${m.sizeGB.toFixed(1)} GB` : ''}
            </span>
            <span style={{ flex: 1 }} />
            {c === 'voice' && (
              <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                Voice
                <select className="field" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} value={voiceName} onChange={(e) => app.set({ voiceName: e.target.value })}>
                  {VOICES.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {c === 'images' && (
              <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                Quality
                <select className="field" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} value={m?.id === IMAGE_BEST.id ? 'best' : 'fast'} onChange={(e) => setImageModel(e.target.value === 'best')}>
                  <option value="fast">Fast (2.3 GB)</option>
                  <option value="best">Best (6.2 GB, strong GPU)</option>
                </select>
              </label>
            )}
            {c !== 'chat' && (
              <button className="btn btn-link" onClick={() => removeCapability(c)}>
                Remove
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src={`/img/cap-${c}.webp`} alt="" style={{ width: 34, height: 34, opacity: a.ok ? 1 : 0.5 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>{capCopy[c].title}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                {a.ok ? capCopy[c].detail : a.reason}
              </div>
            </div>
            {m && <span className="muted" style={{ fontSize: 12 }}>{m.sizeGB.toFixed(1)} GB</span>}
            {a.ok && (
              <button className="btn btn-bordered" onClick={() => addCapability(c)}>
                Add
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Turbo() {
  const d = useDevice()
  const [checking, setChecking] = useState(false)
  const flagBase = d?.browser === 'edge' ? 'edge://flags' : 'chrome://flags'
  const chromium = d?.browser === 'chrome' || d?.browser === 'edge'
  // Chrome and Edge on Windows only run WebGPU on D3D12, where Dawn doesn't expose subgroup matrix (research/F_build_engines.md §4).
  const winBlocked = d?.os === 'windows' && !d?.tensor
  const recheck = async () => {
    setChecking(true)
    await probe()
    setChecking(false)
  }
  const check = (ok: boolean | undefined, label: string, note: string) => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--hair)' }}>
      <span className={`pill ${ok ? 'good' : 'soon'}`} style={{ minWidth: 76, justifyContent: 'center' }}>
        {ok ? 'On' : 'Off'}
      </span>
      <div>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{label}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
          {note}
        </div>
      </div>
    </div>
  )
  return (
    <>
      <div className={`turbo-hero ${d?.tensor ? 'on' : ''}`}>
        <h3>{d?.tensor ? 'Turbo is unlocked' : winBlocked ? 'Tensor cores: Mac and Linux only for now' : 'Unlock your tensor cores'}</h3>
        <p>
          {d?.tensor
            ? `This browser now exposes the tensor cores of your ${d ? gpuName(d) : 'GPU'}: the matrix units that make AI fast.`
            : winBlocked
              ? 'Your graphics card has special matrix units built for AI (tensor cores on NVIDIA). Browsers on Windows can’t reach them yet: Chrome and Edge run your graphics card through Direct3D 12 there, and it doesn’t expose them. In the browser, Turbo works on M1 and newer Macs and on Linux. Prometh runs fine on your graphics card without it.'
              : 'Your graphics card has special matrix units (tensor cores on NVIDIA, the matrix units of M1 and newer Macs) built for AI. Browsers keep them locked by default. One setting unlocks them.'}
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button className="btn btn-welcome" style={{ padding: '9px 18px', fontSize: 13 }} onClick={recheck} disabled={checking}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </div>

      <div className="tile">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Live check · {d ? gpuName(d) : '…'}</div>
        {check(d?.webgpu, 'WebGPU', 'The browser can run AI on your graphics card.')}
        {check(d?.f16, 'Half precision (shader-f16)', d?.f16 ? 'In use now: Prometh runs the faster, smaller model format.' : 'Not on this graphics card or driver. Prometh uses the full-precision format instead; Evil Mode and Images need it.')}
        {check(d?.heapsVisible, 'Real graphics memory readout', d?.heapsVisible ? `In use now: Prometh sees about ${((d?.budgetMB ?? 0) / 1024).toFixed(1)} GB it can use, so it picks the biggest model that fits.` : 'Turn on WebGPU Developer Features below so Prometh can read your real graphics memory and pick the biggest model that fits.')}
        {check(d?.tensor, 'Tensor cores (subgroup matrix)', d?.tensor ? 'Unlocked for this browser. Prometh’s in-browser engines will use them as soon as they support it; the native Prometh Mac app uses them today.' : winBlocked ? 'Not reachable from browsers on Windows yet. Works on M1 and newer Macs and on Linux.' : 'Locked. Follow the steps below.')}
      </div>

      {!chromium && !winBlocked && (
        <div className="tile" style={{ fontSize: 13, lineHeight: 1.55 }}>
          Turbo needs Chrome or Edge on a computer. {d?.browser === 'safari' ? 'Safari' : d?.browser === 'firefox' ? 'Firefox' : 'This browser'} has no switch for tensor cores yet.
        </div>
      )}

      {winBlocked ? (
        <div className="tile">
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Let Prometh read your graphics memory ({d?.browser === 'edge' ? 'Edge' : 'Chrome'})</div>
          <ol className="steps">
            <li>
              <div>
                Copy this address, open a <b>new tab</b>, paste it and press Enter. Set <b>WebGPU Developer Features</b> to <b>Enabled</b>, so Prometh can pick the biggest model that fits:
                <CopyLine text={`${flagBase}/#enable-webgpu-developer-features`} />
              </div>
            </li>
            <li>
              <div>
                Click <b>Relaunch</b> at the bottom of the flags page. Your tabs come back.
              </div>
            </li>
          </ol>
        </div>
      ) : (
        <div className="tile">
          <div style={{ fontWeight: 600, marginBottom: 14 }}>How to unlock ({d?.browser === 'edge' ? 'Edge' : 'Chrome'})</div>
          <ol className="steps">
            <li>
              <div>
                Copy this address, open a <b>new tab</b>, paste it and press Enter. Pages can’t open browser settings themselves, so this one step is yours.
                <CopyLine text={`${flagBase}/#enable-unsafe-webgpu`} />
                Set <b>Unsafe WebGPU Support</b> to <b>Enabled</b>. This unlocks the tensor cores.
              </div>
            </li>
            <li>
              <div>
                In the same flags page, also enable <b>WebGPU Developer Features</b>, so Prometh can read your real graphics memory:
                <CopyLine text={`${flagBase}/#enable-webgpu-developer-features`} />
              </div>
            </li>
            {d?.os === 'linux' && (
              <li>
                <div>
                  On Linux, also enable Vulkan:
                  <CopyLine text={`${flagBase}/#enable-vulkan`} />
                </div>
              </li>
            )}
            <li>
              <div>
                Click <b>Relaunch</b> at the bottom of the flags page. Your tabs come back.
              </div>
            </li>
            <li>
              <div>Come back here. The live check above turns green by itself; press Check again if it doesn’t.</div>
            </li>
          </ol>
        </div>
      )}

      {!winBlocked && (
        <div className="tile" style={{ fontSize: 12, lineHeight: 1.6 }}>
          <b>Good to know.</b> “Unsafe WebGPU” switches off some of the browser’s graphics safety checks for every website, not only Prometh. Keep it on in a browser you use for trusted sites, and set it back to <i>Default</i> when you’re done. In the browser, tensor cores work on M1 and newer Macs, and on Linux with Vulkan on NVIDIA, AMD and Intel cards whose drivers support it. Browsers on Windows can’t reach them yet.
        </div>
      )}
    </>
  )
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copyline">
      <span>{text}</span>
      <button
        className="btn btn-bordered"
        onClick={() => {
          navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Privacy() {
  const [usage, setUsage] = useState<string>('…')
  const [confirm, setConfirm] = useState<'models' | 'all' | null>(null)
  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage(`${((e.usage ?? 0) / 1e9).toFixed(1)} GB used by Prometh in this browser`))
      .catch(() => setUsage(''))
  }, [confirm])
  return (
    <>
      <div style={{ fontWeight: 600 }}>Your data stays on this device.</div>
      <div className="muted" style={{ lineHeight: 1.55 }}>
        No product account. The AI runs on your own graphics card inside this browser: chat, image and voice generation stay on your device. Web searches, page reads and connected-app actions use the backend and their providers. Chats, skills and settings are stored in this browser only.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button className="btn btn-bordered" onClick={() => exportChat()}>
          <Icon name="download" size={13} /> Export current conversation
        </button>
        <button className="btn btn-bordered" onClick={restartOnboarding}>
          Restart onboarding
        </button>
      </div>
      <hr style={{ border: 0, borderTop: '1px solid var(--hair)', width: '100%', margin: '4px 0' }} />
      <div style={{ fontWeight: 600 }}>Storage</div>
      <div className="muted" style={{ fontSize: 13 }}>
        {usage}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button className="btn btn-bordered" onClick={() => setConfirm('models')}>
          Delete downloaded models…
        </button>
        <button className="btn btn-bordered btn-danger" onClick={() => setConfirm('all')}>
          Clear all data…
        </button>
      </div>
      <hr style={{ border: 0, borderTop: '1px solid var(--hair)', width: '100%', margin: '4px 0' }} />
      <div style={{ fontWeight: 600 }}>About</div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        Prometh runs open models in your browser with WebGPU: Qwen3.5 (Alibaba) and Llama 3.2 (Meta) for chat, leyten’s uncensored Qwen3.5 builds for Evil Mode, Whisper (OpenAI) for listening, Kokoro for speaking, and for images Realistic Vision 6 (SG161222) with Hyper-SD (ByteDance) under the CreativeML OpenRAIL-M licence, or Z-Image Turbo (Alibaba Tongyi, Apache 2.0) in Microsoft’s browser build. Engines: WebLLM, Transformers.js and ONNX Runtime. Model files download once. Don’t use Prometh to make sexual or nude images of real people, or anything the image licence forbids.
      </div>
      <div>
        <a className="btn btn-bordered" href="/logout" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Icon name="logout" size={13} /> Sign out
        </a>
      </div>
      {confirm === 'models' && (
        <Confirm title="Delete downloaded models?" body="Frees the storage the AI models use. Your chats stay. Prometh downloads models again when you use them." action="Delete models" onConfirm={() => void deleteDownloads()} onClose={() => setConfirm(null)} />
      )}
      {confirm === 'all' && <Confirm title="Clear all Prometh data?" body="Deletes every conversation, skill, image and setting in this browser. Downloaded models stay." action="Clear everything" onConfirm={() => void resetData()} onClose={() => setConfirm(null)} />}
    </>
  )
}

// ---------- Customize ----------

export function Customize() {
  const close = () => ui.set({ customizeOpen: false })
  return (
    <Sheet onClose={close} width={720} label="Customize">
      <div className="sheet-pad" style={{ display: 'flex', flexDirection: 'column', gap: 20, height: 'min(640px, calc(100vh - 48px))' }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 27, letterSpacing: -0.8 }}>Customize</h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              Plugins, tools and skills.
            </div>
          </div>
          <IconButton icon="x" title="Close Customize" onClick={close} />
        </div>
        <CustomizeBody />
      </div>
    </Sheet>
  )
}

function CustomizeBody() {
  const section = useUI((s) => s.customizeSection)
  return <>
        <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
          {(['Plugins', 'Tools', 'Skills'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={section === s} className={section === s ? 'on' : ''} onClick={() => ui.set({ customizeSection: s })}>
              {s}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>{section === 'Plugins' ? <Plugins /> : section === 'Tools' ? <Tools /> : <Skills />}</div>
  </>
}

export function ToolkitLogo({ logo, name }: { logo?: string; name: string }) {
  const [failed, setFailed] = useState(false)
  const style = { width: 30, height: 30, borderRadius: 8, objectFit: 'contain' as const, flexShrink: 0 }
  return logo && !failed ? <img loading="lazy" referrerPolicy="no-referrer" src={logo} alt="" style={style} onError={() => setFailed(true)} /> : <span className="pill" aria-hidden="true" style={{ ...style, justifyContent: 'center' }}>{name[0]?.toUpperCase()}</span>
}

function Plugins() {
  const [items, setItems] = useState<Toolkit[]>([])
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({})
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const allowed = useApp((s) => s.alwaysAllowed)
  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      const health = await getHealth(ac.signal)
      if (ac.signal.aborted) return
      setConfigured(health.connectors)
      if (!health.connectors) return
      try {
        const [catalog, connections] = await Promise.all([getCatalog(ac.signal), getConnections(ac.signal)])
        if (!ac.signal.aborted) { setItems(catalog); setStatuses(connections.statuses) }
      } catch (e) { if (!ac.signal.aborted) setError((e as Error).message) }
    })()
    return () => ac.abort()
  }, [])
  // Pending OAuth is persisted by Composio, so reopening the sheet resumes polling.
  const pending = Object.entries(statuses).filter(([, s]) => s === 'pending').map(([slug]) => slug).sort().join(',')
  useEffect(() => {
    if (!pending) return
    const ac = new AbortController(), until = Date.now() + 120000
    const timer = window.setInterval(() => {
      if (Date.now() >= until) { clearInterval(timer); return }
      void getConnections(ac.signal).then((data) => { if (!ac.signal.aborted) setStatuses(data.statuses) }).catch(() => {})
    }, 2000)
    return () => { ac.abort(); clearInterval(timer) }
  }, [pending])
  const connect = async (toolkit: string) => {
    // Open synchronously with the click so browsers allow the OAuth window.
    const popup = window.open('about:blank', '_blank')
    if (popup) popup.opener = null
    setBusy((s) => ({ ...s, [toolkit]: true })); setError('')
    try {
      const { redirect_url } = await api<{ redirect_url: string }>('connectors/link', { toolkit })
      if (popup) popup.location.href = redirect_url
      else { setError('Allow popups for Prometh, then connect again.'); return }
      setStatuses((s) => ({ ...s, [toolkit]: 'pending' }))
    } catch (e) { popup?.close(); setError((e as Error).message) }
    finally { setBusy((s) => ({ ...s, [toolkit]: false })) }
  }
  const disconnect = async (toolkit: string) => {
    setBusy((s) => ({ ...s, [toolkit]: true })); setError('')
    try { await api('connectors/disconnect', { toolkit }); setStatuses((s) => ({ ...s, [toolkit]: 'disconnected' })); app.set((s) => ({ alwaysAllowed: resetAllowed(toolkit, s.alwaysAllowed) })) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy((s) => ({ ...s, [toolkit]: false })) }
  }
  if (configured === null) return <div className="muted">Checking plugins…</div>
  if (!configured) return <div className="muted">Plugins are unavailable until the backend has Composio configured.</div>
  const categories = [...new Set(items.flatMap((i) => i.categories))].sort()
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = items.filter((i) => (!category || i.categories.includes(category)) && words.every((w) => [i.name, i.slug, i.description, ...i.categories].join(' ').toLowerCase().includes(w)))
    .sort((a, b) => Number(statuses[b.slug] === 'connected') - Number(statuses[a.slug] === 'connected') || a.name.localeCompare(b.name))
  return <>
    <div className="muted">Apps your AI can use. Writes ask for your permission.</div>
    <input className="field" aria-label="Search plugins" placeholder="Search apps…" value={query} onChange={(e) => setQuery(e.target.value)} />
    <select className="field" aria-label="Plugin category" value={category} onChange={(e) => setCategory(e.target.value)}>
      <option value="">All categories</option>
      {categories.map((c) => <option key={c}>{c}</option>)}
    </select>
    {error && <div className="muted" role="status">{error}</div>}
    {!items.length && !error && <div className="muted">Loading apps…</div>}
    {!!items.length && !filtered.length && <div className="muted">No apps match your search.</div>}
    <div>{filtered.map((item) => {
      const status = statuses[item.slug] ?? 'disconnected'
      const hasAllowed = allowed.some((k) => k.toLowerCase().startsWith(item.slug.toLowerCase() + ':'))
      return <div key={item.slug} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '11px 0', borderBottom: '1px solid var(--hair)' }}>
        <ToolkitLogo logo={item.logo} name={item.name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{item.name} {item.no_auth && <span className="muted">· No auth required</span>}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{item.description}</div>
          {hasAllowed && <button className="btn btn-link" onClick={() => app.set((s) => ({ alwaysAllowed: resetAllowed(item.slug, s.alwaysAllowed) }))}>Reset always-allow</button>}
        </div>
        {status !== 'disconnected' && <span className={`pill ${status === 'connected' ? 'good' : ''}`}>{status}</span>}
        <button className="btn btn-bordered" disabled={busy[item.slug]} onClick={() => void (status === 'connected' || status === 'pending' ? disconnect(item.slug) : connect(item.slug))}>
          {busy[item.slug] ? 'Working…' : status === 'connected' || status === 'pending' ? 'Disconnect' : status === 'expired' ? 'Reconnect' : 'Connect'}
        </button>
      </div>
    })}</div>
    <div className="muted" style={{ fontSize: 11 }}>App requests go through the backend to Composio. Chat generation stays on your device.</div>
  </>
}

function Tools() {
  const read = useApp((s) => s.readAttachments)
  const web = useApp((s) => s.webSearch)
  const [searchAvailable, setSearchAvailable] = useState(false)
  useEffect(() => { const ac = new AbortController(); void getHealth(ac.signal).then((h) => { if (!ac.signal.aborted) setSearchAvailable(h.search) }); return () => ac.abort() }, [])
  const row = (name: string, detail: string, on: boolean, toggle?: () => void) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 15 }}>
          {name}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
          {detail}
        </div>
      </div>
      <button className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={name} onClick={toggle} disabled={!toggle} />
    </div>
  )
  return (
    <>
      <div className="muted">What your AI is allowed to do.</div>
      {row('Read attachments', 'Work with text, code and data files you attach. Files are read in this browser, never uploaded.', read, () => app.set({ readAttachments: !read }))}
      <hr style={{ border: 0, borderTop: '1px solid var(--hair)', width: '100%', margin: 0 }} />
      {row('Web search', searchAvailable ? 'Find fresh information and include sources in replies. Queries and page URLs use the backend.' : 'Unavailable: configure SEARXNG_URL on the backend.', web && searchAvailable, searchAvailable ? () => app.set({ webSearch: !web }) : undefined)}
    </>
  )
}

function Skills() {
  const skills = useApp((s) => s.skills)
  const [editing, setEditing] = useState<Skill | null>(null)
  const [deleting, setDeleting] = useState<Skill | null>(null)
  return (
    <>
      <div className="muted">Reusable instructions for how your AI works.</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" style={{ padding: '9px 18px', fontSize: 13 }} onClick={() => setEditing({ id: uid(), name: '', instructions: '', enabled: true })}>
          Add skill
        </button>
        <label className="btn btn-bordered" style={{ padding: '9px 14px', fontSize: 13 }}>
          Import file…
          <input type="file" accept=".md,.txt,.markdown,text/markdown,text/plain" hidden onChange={(e) => e.target.files?.[0] && void importSkill(e.target.files[0]).finally(() => (e.target.value = ''))} />
        </label>
      </div>
      {!skills.length && (
        <div className="tile">
          <div style={{ fontSize: 18, fontWeight: 500 }}>No skills added</div>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: '10px 0 14px' }}>
            Create a skill or import a Markdown file. For example, ask for concise answers or a particular writing style.
          </div>
          <button className="btn btn-bordered" onClick={() => saveSkill({ id: uid(), name: 'Concise answers', instructions: 'Keep answers concise. Start with the answer and avoid unnecessary explanation.', enabled: true })}>
            Add “Concise answers”
          </button>
        </div>
      )}
      {skills.map((s) => (
        <div key={s.id} className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, fontWeight: 500, fontSize: 15 }}>{s.name}</div>
            <button className={`toggle ${s.enabled ? 'on' : ''}`} role="switch" aria-checked={s.enabled} aria-label={`Enable ${s.name}`} onClick={() => setSkillEnabled(s.id, !s.enabled)} />
          </div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {s.instructions}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-link" onClick={() => setEditing(s)}>
              Edit
            </button>
            <button className="btn btn-link btn-danger" onClick={() => setDeleting(s)}>
              Delete
            </button>
          </div>
        </div>
      ))}
      <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
        Enabled skills are added to the AI’s instructions for every new reply.
      </div>
      {editing && <SkillEditor skill={editing} onClose={() => setEditing(null)} />}
      {deleting && <Confirm title="Delete this skill?" body={`“${deleting.name}” will be removed.`} action="Delete skill" onConfirm={() => deleteSkill(deleting.id)} onClose={() => setDeleting(null)} />}
    </>
  )
}

function SkillEditor({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [s, setS] = useState(skill)
  return (
    <Sheet onClose={onClose} width={560} label="Skill">
      <div className="sheet-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>Skill</h2>
        <input className="field" placeholder="Skill name" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} aria-label="Skill name" />
        <div style={{ fontWeight: 500, fontSize: 13 }}>Instructions</div>
        <textarea className="field" rows={9} value={s.instructions} onChange={(e) => setS({ ...s, instructions: e.target.value })} aria-label="Skill instructions" />
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <button type="button" className={`toggle ${s.enabled ? 'on' : ''}`} role="switch" aria-checked={s.enabled} onClick={() => setS({ ...s, enabled: !s.enabled })} /> Enable for new replies
        </label>
        <div className="acts">
          <button className="btn btn-plain" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!s.name.trim() || !s.instructions.trim()}
            onClick={() => {
              saveSkill(s)
              onClose()
            }}
          >
            Save skill
          </button>
        </div>
      </div>
    </Sheet>
  )
}
