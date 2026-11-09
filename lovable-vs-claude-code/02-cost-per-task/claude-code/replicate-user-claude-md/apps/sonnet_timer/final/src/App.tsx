import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CYCLE_LENGTH,
  MAX_MINUTES,
  MIN_MINUTES,
  PHASE_LABEL,
  applySettings,
  formatTime,
  initialState,
  parseMinutes,
  remaining,
  reset,
  skip,
  tabTitle,
  tick,
  toggle,
  todaysEntries,
  type LogEntry,
  type Settings,
  type TimerState,
} from './timer'
import { loadHistory, loadSettings, saveHistory, saveSettings } from './storage'
import Stats from './StatsView'
import { chime, primeAudio } from './sound'

const ACCENT = {
  focus: { ring: 'stroke-rose-400', text: 'text-rose-500', dot: 'bg-rose-400', btn: 'bg-rose-500 hover:bg-rose-600' },
  short: { ring: 'stroke-teal-500', text: 'text-teal-600', dot: 'bg-teal-500', btn: 'bg-teal-600 hover:bg-teal-700' },
  long: { ring: 'stroke-indigo-400', text: 'text-indigo-500', dot: 'bg-indigo-400', btn: 'bg-indigo-500 hover:bg-indigo-600' },
} as const

const fmtClock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [timer, setTimerState] = useState<TimerState>(() => initialState(loadSettings()))
  const [now, setNow] = useState(() => Date.now())
  const [task, setTask] = useState('')
  const [history, setHistory] = useState<LogEntry[]>(loadHistory)
  const [view, setView] = useState<'timer' | 'stats'>('timer')
  const viewRef = useRef(view)
  viewRef.current = view
  const today = todaysEntries(history, now)
  const [showSettings, setShowSettings] = useState(false)

  // Refs hold the latest values so callbacks never act on stale state and
  // side effects (log entry, chime) run exactly once per finished phase.
  const timerRef = useRef(timer)
  const settingsRef = useRef(settings)
  const taskRef = useRef(task)
  settingsRef.current = settings
  taskRef.current = task

  const setTimer = useCallback((next: TimerState) => {
    timerRef.current = next
    setTimerState(next)
  }, [])

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => saveHistory(history), [history])

  const advance = useCallback(() => {
    const t = Date.now()
    setNow(t)
    const r = tick(timerRef.current, settingsRef.current, t)
    if (!r.finished) return
    setTimer(r.state)
    if (!settingsRef.current.muted) chime()
    if (r.finished.phase === 'focus') {
      const entry: LogEntry = {
        id: String(t) + '-' + Math.random().toString(36).slice(2, 7),
        task: taskRef.current.trim(),
        finishedAt: t,
        minutes: settingsRef.current.focus,
      }
      setHistory((l) => [...l, entry])
    }
  }, [setTimer])

  // Timestamp-based: every tick recomputes from endAt, so throttled background
  // timers cannot drift; we also re-check the moment the tab becomes visible.
  useEffect(() => {
    if (timer.status !== 'running') return
    const id = setInterval(advance, 250)
    const onVisible = () => {
      if (document.visibilityState === 'visible') advance()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [timer.status, advance])

  const left = remaining(timer, now)
  useEffect(() => {
    document.title = tabTitle(timer, now)
  }, [timer, now])

  const onToggle = useCallback(() => {
    primeAudio()
    const t = Date.now()
    setNow(t)
    setTimer(toggle(timerRef.current, t))
  }, [setTimer])
  const onReset = () => setTimer(reset(timerRef.current, settings))
  const onSkip = () => {
    setNow(Date.now())
    setTimer(skip(timerRef.current, settings))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || viewRef.current !== 'timer') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
      e.preventDefault()
      onToggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onToggle])

  const updateSettings = (s: Settings) => {
    setSettings(s)
    settingsRef.current = s
    setTimer(applySettings(timerRef.current, s))
  }

  const accent = ACCENT[timer.phase]
  const total = settings[timer.phase] * 60_000
  const progress = Math.min(1, Math.max(0, 1 - left / total))
  const R = 130
  const C = 2 * Math.PI * R
  const running = timer.status === 'running'
  const dotsDone = timer.cycle

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800">
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-6 sm:py-10">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Pomodoro</h1>
          <div className="flex gap-2">
            <button
              onClick={() => updateSettings({ ...settings, muted: !settings.muted })}
              aria-pressed={settings.muted}
              aria-label={settings.muted ? 'Unmute sound' : 'Mute sound'}
              className="rounded-full border border-stone-200 bg-white px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
            >
              {settings.muted ? '🔇 Muted' : '🔊 Sound on'}
            </button>
            <button
              onClick={() => setShowSettings((v) => !v)}
              aria-expanded={showSettings}
              className="rounded-full border border-stone-200 bg-white px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
            >
              ⚙ Settings
            </button>
          </div>
        </header>

        <nav role="tablist" aria-label="View" className="grid grid-cols-2 gap-1 rounded-2xl bg-stone-200/60 p-1">
          {(['timer', 'stats'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => {
                setNow(Date.now())
                setView(v)
              }}
              className={
                'rounded-xl px-4 py-2 text-sm font-medium capitalize ' +
                (view === v ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700')
              }
            >
              {v}
            </button>
          ))}
        </nav>

        {view === 'stats' && <Stats history={history} now={now} />}

        {view === 'timer' && showSettings && <SettingsPanel settings={settings} onSave={updateSettings} />}
        {view === 'timer' && (
          <>

        <section className="flex flex-col items-center gap-5 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200 sm:p-6">
          <div className={'text-sm font-medium uppercase tracking-widest ' + accent.text} data-testid="phase">
            {PHASE_LABEL[timer.phase]}
          </div>

          <div className="relative grid aspect-square w-full max-w-[300px] place-items-center">
            <svg viewBox="0 0 300 300" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
              <circle cx="150" cy="150" r={R} fill="none" className="stroke-stone-100" strokeWidth="10" />
              <circle
                cx="150"
                cy="150"
                r={R}
                fill="none"
                className={accent.ring}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - progress)}
              />
            </svg>
            <div
              className="text-[5.5rem] leading-none font-light tabular-nums tracking-tight sm:text-8xl"
              data-testid="countdown"
              role="timer"
              aria-label={formatTime(left) + ' remaining'}
            >
              {formatTime(left)}
            </div>
          </div>

          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            maxLength={80}
            placeholder="What are you working on? (optional)"
            aria-label="Task label"
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-center text-base outline-none placeholder:text-stone-400 focus:border-stone-400"
          />

          <div
            className="flex items-center gap-1.5"
            role="img"
            aria-label={dotsDone + ' of ' + CYCLE_LENGTH + ' focus sessions toward Recharge'}
            data-testid="dots"
          >
            {Array.from({ length: CYCLE_LENGTH }, (_, i) => (
              <span
                key={i}
                data-filled={i < dotsDone}
                className={'h-3 w-3 rounded-full ' + (i < dotsDone ? accent.dot : 'bg-stone-200')}
              />
            ))}
            <span className="ml-2 text-sm text-stone-500" data-testid="dots-text">
              {dotsDone} of {CYCLE_LENGTH}
            </span>
          </div>

          <div className="grid w-full grid-cols-[2fr_1fr_1fr] gap-2">
            <button onClick={onToggle} className={'rounded-xl px-4 py-3 text-base font-medium text-white ' + accent.btn}>
              {running ? 'Pause' : 'Start'}
            </button>
            <button onClick={onReset} className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-700 hover:bg-stone-100">
              Reset
            </button>
            <button onClick={onSkip} className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-700 hover:bg-stone-100">
              Skip
            </button>
          </div>
          <p className="hidden text-xs text-stone-400 sm:block">Press Space to start or pause</p>
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200 sm:p-6">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-widest text-stone-500">Today</h2>
          {today.length === 0 ? (
            <p className="text-sm text-stone-400" data-testid="log-empty">
              No focus sessions finished yet.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100" data-testid="log">
              {[...today].reverse().map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className={e.task ? 'truncate' : 'text-stone-400'}>{e.task || 'Untitled session'}</span>
                  <time className="shrink-0 tabular-nums text-stone-500" dateTime={new Date(e.finishedAt).toISOString()}>
                    {fmtClock(e.finishedAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-stone-400">
            {today.length} focus session{today.length === 1 ? '' : 's'} today
          </p>
        </section>
          </>
        )}
      </main>
    </div>
  )
}

function SettingsPanel({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  const [vals, setVals] = useState({
    focus: String(settings.focus),
    short: String(settings.short),
    long: String(settings.long),
  })
  const [saved, setSaved] = useState(false)
  const fields = [
    ['focus', 'Focus'],
    ['short', 'Short break'],
    ['long', 'Recharge'],
  ] as const
  const parsed = {
    focus: parseMinutes(vals.focus),
    short: parseMinutes(vals.short),
    long: parseMinutes(vals.long),
  }
  const valid = parsed.focus !== null && parsed.short !== null && parsed.long !== null

  return (
    <form
      className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-stone-200 sm:p-6"
      aria-label="Settings"
      onSubmit={(e) => {
        e.preventDefault()
        if (parsed.focus === null || parsed.short === null || parsed.long === null) return
        onSave({ ...settings, focus: parsed.focus, short: parsed.short, long: parsed.long })
        setSaved(true)
      }}
    >
      <h2 className="mb-3 text-sm font-medium uppercase tracking-widest text-stone-500">Durations (minutes)</h2>
      <div className="grid gap-3">
        {fields.map(([k, label]) => {
          const bad = parsed[k] === null
          return (
            <label key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-sm">
              <span>{label}</span>
              <input
                inputMode="numeric"
                value={vals[k]}
                onChange={(e) => {
                  setSaved(false)
                  setVals({ ...vals, [k]: e.target.value })
                }}
                aria-invalid={bad}
                aria-label={label + ' minutes'}
                className={
                  'w-20 rounded-lg border px-3 py-2 text-right text-base outline-none ' +
                  (bad ? 'border-red-400 bg-red-50' : 'border-stone-200 focus:border-stone-400')
                }
              />
              {bad && (
                <span className="col-span-2 mt-1 text-xs text-red-600" role="alert">
                  Enter a whole number from {MIN_MINUTES} to {MAX_MINUTES}.
                </span>
              )}
            </label>
          )
        })}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={!valid}
          className="rounded-xl bg-stone-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
        {saved && (
          <span className="text-sm text-teal-600" role="status">
            Saved
          </span>
        )}
      </div>
    </form>
  )
}
