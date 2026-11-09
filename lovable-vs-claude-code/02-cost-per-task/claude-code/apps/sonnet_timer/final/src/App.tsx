import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as T from './timer'
import StatsView from './StatsView'
import type { LogEntry, Phase, Settings, TimerState } from './timer'

const SETTINGS_KEY = 'pomodoro.settings'
const LOG_KEY = 'pomodoro.log'

function load<V>(key: string, sanitize: (raw: unknown) => V): V {
  try {
    const s = localStorage.getItem(key)
    return sanitize(s ? JSON.parse(s) : null)
  } catch {
    return sanitize(null)
  }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

let audioCtx: AudioContext | null = null
function primeAudio() {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch { /* no audio */ }
}
function chime() {
  try {
    primeAudio()
    const ctx = audioCtx
    if (!ctx) return
    ;[660, 880, 1320].forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.18
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.32)
    })
  } catch { /* ignore */ }
}

const THEME: Record<Phase, { btn: string; soft: string; text: string; dot: string }> = {
  focus: { btn: 'bg-rose-500 hover:bg-rose-600', soft: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  short: { btn: 'bg-teal-600 hover:bg-teal-700', soft: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-600' },
  long: { btn: 'bg-sky-600 hover:bg-sky-700', soft: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-600' },
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => load(SETTINGS_KEY, T.sanitizeSettings))
  const [log, setLog] = useState<LogEntry[]>(() => load(LOG_KEY, T.sanitizeLog))
  const [timer, setTimer] = useState<TimerState>(() => ({
    ...T.initialState(load(SETTINGS_KEY, T.sanitizeSettings)),
    // after a reload, dots resume from today's finished sessions
    cycle: T.todaysEntries(load(LOG_KEY, T.sanitizeLog), Date.now()).length % T.CYCLE,
  }))
  const [now, setNow] = useState(() => Date.now())
  const [label, setLabel] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [tab, setTab] = useState<'timer' | 'stats'>('timer')

  const timerRef = useRef(timer)
  const settingsRef = useRef(settings)
  const labelRef = useRef(label)
  const tabRef = useRef(tab)
  settingsRef.current = settings
  labelRef.current = label
  tabRef.current = tab

  const commit = useCallback((next: TimerState) => {
    timerRef.current = next
    setTimer(next)
    setNow(Date.now())
  }, [])

  useEffect(() => save(SETTINGS_KEY, settings), [settings])
  useEffect(() => save(LOG_KEY, log), [log])

  // Re-evaluate against the wall clock; safe to call as often as we like.
  const sync = useCallback(() => {
    const t = Date.now()
    const { state, finished } = T.tick(timerRef.current, settingsRef.current, t)
    if (finished) {
      if (!settingsRef.current.muted) chime()
      if (finished === 'focus') {
        const entry: LogEntry = { id: `${t}-${Math.random().toString(36).slice(2, 7)}`, label: labelRef.current.trim(), finishedAt: t, minutes: settingsRef.current.focus }
        setLog((l) => [...l, entry])
      }
      commit(state)
    } else {
      setNow(t)
    }
  }, [commit])

  const running = T.isRunning(timer)
  useEffect(() => {
    if (!running) return
    const id = setInterval(sync, 250)
    document.addEventListener('visibilitychange', sync)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', sync) }
  }, [running, sync])

  const toggle = useCallback(() => {
    primeAudio()
    const t = Date.now()
    commit(T.isRunning(timerRef.current) ? T.pause(timerRef.current, t) : T.start(timerRef.current, t))
  }, [commit])
  const doReset = () => commit(T.reset(timerRef.current, settingsRef.current))
  const doSkip = () => commit(T.skip(timerRef.current, settingsRef.current))

  // Space bar toggles, unless typing in a field.
  useEffect(() => {
    const isField = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      // fields keep Space for typing; tabs keep it for activation; only the Timer tab uses it to start/pause
      return (
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || el.getAttribute('role') === 'tab')
      ) || tabRef.current !== 'timer'
    }
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isField(e)) return
      e.preventDefault()
      if (!e.repeat) toggle()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField(e)) e.preventDefault() // stop a focused button also "clicking"
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [toggle])

  const ms = T.remainingMs(timer, now)
  useEffect(() => { document.title = T.titleFor(timer, now) }, [timer, now])

  const updateSettings = (next: Settings) => {
    const old = settingsRef.current
    settingsRef.current = next
    setSettings(next)
    // An untouched (idle, full-length) phase picks up the new duration straight away.
    const cur = timerRef.current
    if (!T.isRunning(cur) && cur.remaining === T.phaseMs(old, cur.phase)) {
      commit({ ...cur, remaining: T.phaseMs(next, cur.phase) })
    }
  }

  const today = useMemo(() => T.todaysEntries(log, now), [log, now])
  const th = THEME[timer.phase]
  const dots = T.filledDots(timer)
  const total = T.phaseMs(settings, timer.phase)
  const progress = Math.min(1, Math.max(0, 1 - ms / total))
  const fmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`min-h-screen transition-colors duration-500 ${th.soft} text-slate-800`}>
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6 sm:py-10">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Pomodoro</h1>
          {tab === 'timer' && <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={settings.muted}
              onClick={() => updateSettings({ ...settings, muted: !settings.muted })}
              className="rounded-full bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
            >
              {settings.muted ? '🔇 Muted' : '🔔 Sound on'}
            </button>
            <button
              type="button"
              aria-expanded={showSettings}
              onClick={() => setShowSettings((s) => !s)}
              className="rounded-full bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
            >
              ⚙ Settings
            </button>
          </div>}
        </header>

        <div
          role="tablist"
          aria-label="View"
          className="grid grid-cols-2 gap-1 rounded-full bg-white/70 p-1 ring-1 ring-slate-200"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              const next = tab === 'timer' ? 'stats' : 'timer'
              setTab(next)
              document.getElementById(`tab-${next}`)?.focus()
            }
          }}
        >
          {(['timer', 'stats'] as const).map((id) => (
            <button
              key={id}
              id={`tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${tab === id ? `${th.btn} text-white shadow-sm` : 'text-slate-600 hover:bg-white'}`}
            >
              {id === 'timer' ? 'Timer' : 'Stats'}
            </button>
          ))}
        </div>

        {tab === 'stats' ? <StatsView log={log} /> : (<>
        {showSettings && <SettingsPanel settings={settings} onChange={updateSettings} />}

        <section className="rounded-3xl bg-white p-4 text-center sm:p-6 shadow-sm ring-1 ring-slate-200">
          <p data-testid="phase" className={`text-sm font-semibold uppercase tracking-widest ${th.text}`}>
            {T.PHASE_NAME[timer.phase]}
          </p>
          <div
            data-testid="countdown"
            role="timer"
            aria-live="off"
            className="my-3 text-[clamp(5rem,31vw,7.5rem)] font-light leading-none tabular-nums tracking-tight"
          >
            {T.formatTime(ms)}
          </div>
          <div className="mx-auto mb-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full ${th.dot} transition-[width] duration-300`} style={{ width: `${progress * 100}%` }} />
          </div>

          <label className="block text-left text-sm text-slate-500">
            <span className="mb-1 block">{timer.phase === 'focus' ? 'What are you working on?' : 'Task for next focus session'}</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              placeholder="Optional task label"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-base text-slate-800 outline-none focus:border-slate-400 focus:bg-white"
            />
          </label>

          <div className="mt-5 grid grid-cols-[2fr_1fr_1fr] gap-2">
            <button type="button" onClick={toggle} className={`rounded-xl px-4 py-3.5 text-base font-semibold text-white ${th.btn}`}>
              {running ? 'Pause' : 'Start'}
            </button>
            <button type="button" onClick={doReset} className="rounded-xl bg-slate-100 px-3 py-3.5 text-base font-medium hover:bg-slate-200">
              Reset
            </button>
            <button type="button" onClick={doSkip} className="rounded-xl bg-slate-100 px-3 py-3.5 text-base font-medium hover:bg-slate-200">
              Skip
            </button>
          </div>
          <p className="mt-3 hidden text-xs text-slate-400 sm:block">Press Space to start / pause</p>

          <div className="mt-5 flex flex-col items-center gap-2" data-testid="dots">
            <div className="flex gap-2" role="img" aria-label={`${dots} of ${T.CYCLE} focus sessions done before Recharge`}>
              {Array.from({ length: T.CYCLE }, (_, i) => (
                <span key={i} data-filled={i < dots} className={`h-3 w-3 rounded-full ${i < dots ? th.dot : 'bg-slate-200'}`} />
              ))}
            </div>
            <span className="text-xs text-slate-500">{dots} of {T.CYCLE} until Recharge</span>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-500">Today</h2>
          {today.length === 0 ? (
            <p className="text-sm text-slate-400">No focus sessions finished yet.</p>
          ) : (
            <ul data-testid="log" className="divide-y divide-slate-100">
              {[...today].reverse().map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className={`min-w-0 break-words ${e.label ? '' : 'italic text-slate-400'}`}>{e.label || 'Untitled session'}</span>
                  <time className="shrink-0 tabular-nums text-slate-500">{fmt.format(e.finishedAt)}</time>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-400">{today.length} focus session{today.length === 1 ? '' : 's'} today</p>
        </section>
        </>)}
      </main>
    </div>
  )
}

type Key = 'focus' | 'short' | 'long'

function SettingsPanel({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const fields: { key: Key; label: string }[] = [
    { key: 'focus', label: 'Focus' },
    { key: 'short', label: 'Short break' },
    { key: 'long', label: 'Recharge' },
  ]
  const [draft, setDraft] = useState({ focus: String(settings.focus), short: String(settings.short), long: String(settings.long) })
  const [errors, setErrors] = useState<Record<string, boolean>>({})

  const edit = (key: Key, raw: string) => {
    setDraft((d) => ({ ...d, [key]: raw }))
    const v = T.parseMinutes(raw)
    setErrors((e) => ({ ...e, [key]: v === null }))
    if (v !== null) onChange({ ...settings, [key]: v })
  }
  const blur = (key: Key) => {
    if (!errors[key]) return
    setDraft((d) => ({ ...d, [key]: String(settings[key]) }))
    setErrors((e) => ({ ...e, [key]: false }))
  }

  return (
    <section aria-label="Settings" className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-500">Durations (minutes)</h2>
      <div className="grid grid-cols-3 gap-3">
        {fields.map((f) => (
          <label key={f.key} className="text-sm text-slate-600">
            {f.label}
            <input
              inputMode="numeric"
              value={draft[f.key]}
              onChange={(e) => edit(f.key, e.target.value)}
              onBlur={() => blur(f.key)}
              aria-invalid={!!errors[f.key]}
              className={`mt-1 w-full rounded-xl border px-3 py-3 text-base outline-none ${errors[f.key] ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-slate-50 focus:border-slate-400'}`}
            />
            {errors[f.key] && <span role="alert" className="mt-1 block text-xs text-red-600">Whole number, 1 to 90</span>}
          </label>
        ))}
      </div>
    </section>
  )
}
