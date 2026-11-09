import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  PHASE_LABEL,
  SESSIONS_PER_CYCLE,
  type LogEntry,
  type Phase,
  type Settings,
  type TimerState,
  applySettings,
  formatTime,
  loadLog,
  loadMuted,
  loadSettings,
  loadTimer,
  pause,
  remaining,
  reset,
  saveLog,
  saveMuted,
  saveSettings,
  saveTimer,
  skip,
  start,
  tabTitle,
  tick,
  todaysLog,
  validateMinutes,
} from './timer'
import { playChime, unlockAudio } from './sound'
import Stats from './StatsView'

const TASK_KEY = 'pomodoro.task'

type View = 'timer' | 'stats'
const VIEWS: { id: View; label: string }[] = [
  { id: 'timer', label: 'Timer' },
  { id: 'stats', label: 'Stats' },
]

const THEME: Record<Phase, { bg: string; accent: string; soft: string; ring: string }> = {
  focus: { bg: 'bg-[#f6efe9]', accent: 'bg-[#b5654a] text-white hover:bg-[#9f5640]', soft: 'text-[#9f5640]', ring: 'stroke-[#b5654a]' },
  short: { bg: 'bg-[#ecf2ec]', accent: 'bg-[#4f7a5e] text-white hover:bg-[#426852]', soft: 'text-[#426852]', ring: 'stroke-[#4f7a5e]' },
  long: { bg: 'bg-[#e9eff5]', accent: 'bg-[#4b6a8a] text-white hover:bg-[#3e5a77]', soft: 'text-[#3e5a77]', ring: 'stroke-[#4b6a8a]' },
}

function readTask(): string {
  try {
    return localStorage.getItem(TASK_KEY) ?? ''
  } catch {
    return ''
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(localStorage))
  const [timer, setTimer] = useState<TimerState>(() => loadTimer(localStorage, settings))
  const [log, setLog] = useState<LogEntry[]>(() => loadLog(localStorage))
  const [view, setView] = useState<View>('timer')
  const [muted, setMuted] = useState(() => loadMuted(localStorage))
  const [task, setTask] = useState(readTask)
  const [showSettings, setShowSettings] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Refs so the interval callback always sees the latest values without re-subscribing.
  const latest = useRef({ timer, settings, muted, task })
  latest.current = { timer, settings, muted, task }

  // Persist.
  useEffect(() => saveTimer(localStorage, timer), [timer])
  useEffect(() => saveSettings(localStorage, settings), [settings])
  useEffect(() => saveLog(localStorage, log), [log])
  useEffect(() => saveMuted(localStorage, muted), [muted])
  useEffect(() => {
    try {
      localStorage.setItem(TASK_KEY, task)
    } catch {
      /* ignore */
    }
  }, [task])

  // Advance the clock from timestamps. Runs on an interval and whenever the tab becomes visible.
  const advance = useCallback(() => {
    const t = Date.now()
    setNow(t)
    const { timer: cur, settings: s, muted: m, task: label } = latest.current
    const r = tick(cur, s, t)
    if (!r.completed) return
    latest.current.timer = r.state
    setTimer(r.state)
    if (r.completed.phase === 'focus') {
      const entry: LogEntry = {
        id: `${r.completed.endedAt}-${Math.random().toString(36).slice(2, 8)}`,
        task: label.trim(),
        finishedAt: r.completed.endedAt,
        minutes: s.focus,
      }
      setLog((l) => [...l, entry]) // full history: Stats and CSV export use every day
    }
    if (!m) playChime()
  }, [])

  useEffect(() => {
    advance()
    const id = window.setInterval(advance, 250)
    const onVis = () => advance()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [advance])

  const title = tabTitle(timer, now)
  useEffect(() => {
    document.title = title
  }, [title])

  const onStartPause = useCallback(() => {
    const t = Date.now()
    setNow(t)
    setTimer((cur) => {
      if (cur.status === 'running') return pause(cur, t)
      unlockAudio()
      return start(cur, t)
    })
  }, [])
  const onReset = () => setTimer((cur) => reset(cur, settings))
  const onSkip = () => setTimer((cur) => skip(cur, settings))

  // Space toggles start/pause, except while typing or in the settings panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      if (showSettings) return
      e.preventDefault() // also stops a focused button from being "clicked" by the same keypress
      if (!e.repeat) onStartPause()
    }
    const swallowKeyup = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if ((e.code === 'Space' || e.key === ' ') && el?.tagName === 'BUTTON' && !showSettings) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', swallowKeyup)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', swallowKeyup)
    }
  }, [onStartPause, showSettings])

  const saveNewSettings = (s: Settings) => {
    setSettings(s)
    setTimer((cur) => applySettings(cur, s))
    setShowSettings(false)
  }

  const theme = THEME[timer.phase]
  const rem = remaining(timer, now)
  const total = settings[timer.phase] * 60_000
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - rem / total)) : 0
  const today = todaysLog(log, now)
  const running = timer.status === 'running'

  return (
    <div className={`min-h-dvh ${theme.bg} text-stone-800 transition-colors duration-700`}>
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 pb-10 pt-5 sm:pt-10">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Pomodoro</h1>
          <div className="flex gap-2">
            <IconButton
              label={muted ? 'Unmute sound' : 'Mute sound'}
              pressed={muted}
              onClick={() => setMuted((m) => !m)}
            >
              {muted ? <SpeakerOff /> : <SpeakerOn />}
            </IconButton>
            <IconButton label="Settings" onClick={() => setShowSettings(true)}>
              <Gear />
            </IconButton>
          </div>
        </header>

        <div
          role="tablist"
          aria-label="View"
          className="-mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-black/[0.05] p-1"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
            e.preventDefault()
            const i = VIEWS.findIndex((v) => v.id === view)
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? VIEWS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length
            setView(VIEWS[next].id)
            document.getElementById(`tab-${VIEWS[next].id}`)?.focus()
          }}
        >
          {VIEWS.map((v) => {
            const selected = view === v.id
            return (
              <button
                key={v.id}
                id={`tab-${v.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`panel-${v.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setView(v.id)}
                className={`h-10 rounded-xl text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-stone-700 ${
                  selected ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {v.label}
                {v.id === 'timer' && !selected && timer.status !== 'idle' && (
                  <span className="ml-1.5 tabular-nums text-stone-400" data-testid="tab-time">
                    {formatTime(rem)}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {view === 'stats' ? (
          <main id="panel-stats" role="tabpanel" aria-labelledby="tab-stats">
            <Stats log={log} now={now} />
          </main>
        ) : (
        <main id="panel-timer" role="tabpanel" aria-labelledby="tab-timer" className="flex flex-col gap-6">
          <section className="rounded-3xl bg-white/70 px-5 py-6 shadow-sm ring-1 ring-black/5 backdrop-blur">
            <p data-testid="phase" className={`text-center text-sm font-medium uppercase tracking-[0.18em] ${theme.soft}`}>
              {PHASE_LABEL[timer.phase]}
            </p>

            <div className="relative mx-auto my-4 aspect-square w-full max-w-[19rem] sm:max-w-[17rem]">
              <svg data-testid="ring" viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden="true">
                <circle cx="50" cy="50" r="46" fill="none" className="stroke-black/[0.06]" strokeWidth="3" />
                <circle
                  key={timer.phase /* a new phase starts from an empty ring instead of animating back */}
                  opacity={progress > 0 ? 1 : 0}
                  cx="50"
                  cy="50"
                  r="46"
                  fill="none"
                  className={`${theme.ring} transition-[stroke-dashoffset] duration-300`}
                  strokeWidth="3"
                  strokeLinecap="round"
                  pathLength={100}
                  strokeDasharray="100"
                  strokeDashoffset={100 - progress * 100}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <time
                  data-testid="countdown"
                  role="timer"
                  aria-label={`${formatTime(rem)} remaining`}
                  className="text-[5.75rem] font-extralight leading-none tabular-nums tracking-tight sm:text-[5rem]"
                >
                  {formatTime(rem)}
                </time>
                <p className="mt-2 text-xs text-stone-500">{running ? 'running' : timer.status === 'paused' ? 'paused' : 'ready'}</p>
              </div>
            </div>

            <Dots done={timer.completedInCycle} phase={timer.phase} />

            <div className="mt-6 grid grid-cols-[1fr_auto_auto] gap-2">
              <button
                type="button"
                onClick={onStartPause}
                className={`h-12 rounded-2xl text-base font-semibold shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 ${theme.accent}`}
              >
                {running ? 'Pause' : timer.status === 'paused' ? 'Resume' : 'Start'}
              </button>
              <button type="button" onClick={onReset} className="btn-secondary">
                Reset
              </button>
              <button type="button" onClick={onSkip} className="btn-secondary">
                Skip
              </button>
            </div>
            <p className="mt-3 hidden text-center text-xs text-stone-500 sm:block">
              Press <kbd className="rounded border border-stone-300 bg-white px-1.5 py-0.5 font-sans">Space</kbd> to start or pause
            </p>
          </section>

          <section className="rounded-3xl bg-white/70 px-5 py-4 shadow-sm ring-1 ring-black/5">
            <label htmlFor="task" className="text-sm font-medium text-stone-600">
              Working on
            </label>
            <input
              id="task"
              value={task}
              maxLength={80}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              placeholder="Optional task for this focus session"
              className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base outline-none placeholder:text-stone-400 focus:border-stone-400"
            />
          </section>

          <section aria-labelledby="log-title" className="rounded-3xl bg-white/70 px-5 py-4 shadow-sm ring-1 ring-black/5">
            <div className="flex items-baseline justify-between">
              <h2 id="log-title" className="text-sm font-medium text-stone-600">
                Today
              </h2>
              <p className="text-xs text-stone-500" data-testid="log-summary">
                {today.length} {today.length === 1 ? 'session' : 'sessions'} · {today.reduce((a, e) => a + e.minutes, 0)} min
              </p>
            </div>
            {today.length === 0 ? (
              <p className="py-4 text-center text-sm text-stone-400">Completed focus sessions will show up here.</p>
            ) : (
              <ol data-testid="log" className="mt-2 divide-y divide-stone-200/70">
                {[...today].reverse().map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className={`min-w-0 truncate ${e.task ? '' : 'italic text-stone-400'}`}>{e.task || 'No task label'}</span>
                    <span className="shrink-0 tabular-nums text-stone-500">
                      {new Date(e.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </main>
        )}
      </div>

      {showSettings && <SettingsPanel initial={settings} onSave={saveNewSettings} onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function Dots({ done, phase }: { done: number; phase: Phase }) {
  const n = Math.min(done, SESSIONS_PER_CYCLE)
  return (
    <div className="flex flex-col items-center gap-1.5" data-testid="dots" aria-label={`${n} of ${SESSIONS_PER_CYCLE} focus sessions before Recharge`}>
      <div className="flex gap-2.5" aria-hidden="true">
        {Array.from({ length: SESSIONS_PER_CYCLE }, (_, i) => (
          <span
            key={i}
            data-filled={i < n}
            className={`size-2.5 rounded-full transition-colors ${i < n ? 'bg-stone-700' : 'bg-stone-300'}`}
          />
        ))}
      </div>
      <p className="text-xs text-stone-500">
        {phase === 'long' ? 'Recharge earned' : `${n} of ${SESSIONS_PER_CYCLE} until Recharge`}
      </p>
    </div>
  )
}

function SettingsPanel({ initial, onSave, onClose }: { initial: Settings; onSave: (s: Settings) => void; onClose: () => void }) {
  const [values, setValues] = useState({ focus: String(initial.focus), short: String(initial.short), long: String(initial.long) })
  const errors = {
    focus: validateMinutes(values.focus),
    short: validateMinutes(values.short),
    long: validateMinutes(values.long),
  }
  const valid = !errors.focus && !errors.short && !errors.long
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    onSave({ focus: Number(values.focus), short: Number(values.short), long: Number(values.long) })
  }

  const fields: { key: keyof Settings; label: string }[] = [
    { key: 'focus', label: 'Focus' },
    { key: 'short', label: 'Short break' },
    { key: 'long', label: 'Recharge' },
  ]

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-stone-900/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        noValidate
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-7 shadow-xl sm:rounded-3xl"
      >
        <h2 id="settings-title" className="text-lg font-semibold">
          Settings
        </h2>
        <p className="mt-1 text-sm text-stone-500">Durations in minutes, 1–90. Recharge follows every 4 focus sessions.</p>
        <div className="mt-4 flex flex-col gap-3">
          {fields.map(({ key, label }, i) => (
            <div key={key}>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={`set-${key}`} className="text-sm font-medium">
                  {label}
                </label>
                <input
                  id={`set-${key}`}
                  ref={i === 0 ? firstRef : undefined}
                  inputMode="numeric"
                  value={values[key]}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  aria-invalid={!!errors[key]}
                  aria-describedby={errors[key] ? `err-${key}` : undefined}
                  className={`w-24 rounded-xl border bg-white px-3 py-2 text-right text-base tabular-nums outline-none ${
                    errors[key] ? 'border-red-400 focus:border-red-500' : 'border-stone-200 focus:border-stone-400'
                  }`}
                />
              </div>
              {errors[key] && (
                <p id={`err-${key}`} role="alert" className="mt-1 text-right text-xs text-red-600">
                  {errors[key]}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-sm text-stone-500 underline-offset-2 hover:underline"
            onClick={() =>
              setValues({ focus: String(DEFAULT_SETTINGS.focus), short: String(DEFAULT_SETTINGS.short), long: String(DEFAULT_SETTINGS.long) })
            }
          >
            Restore defaults
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!valid}
              className="h-12 rounded-2xl bg-stone-800 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function IconButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="grid size-10 place-items-center rounded-full text-stone-600 transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-stone-700"
    >
      {children}
    </button>
  )
}

const svg = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const SpeakerOn = () => (
  <svg {...svg}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
)
const SpeakerOff = () => (
  <svg {...svg}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="m22 9-6 6M16 9l6 6" />
  </svg>
)
const Gear = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
)
