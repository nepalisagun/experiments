import { useEffect, useRef, useState } from 'react'
import { usePomodoro } from './usePomodoro'
import { formatTime, PHASE_LABEL, SESSIONS_PER_CYCLE, validateMinutes, type Phase, type Settings } from './lib/timer'
import { formatClock, todaysEntries, type LogEntry } from './lib/log'
import { Stats } from './Stats'

type View = 'timer' | 'stats'

export default function App() {
  const p = usePomodoro()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [view, setView] = useState<View>('timer')
  const { phase, status } = p.timer

  // Space bar starts/pauses on the Timer view, unless the user is typing.
  useEffect(() => {
    if (view !== 'timer') return
    const isTyping = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      if (settingsOpen || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault() // also stops a focused button from being "clicked" by Space
      if (!e.repeat) p.toggle()
    }
    const onUp = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.key === ' ') && !settingsOpen && !isTyping(e.target)) e.preventDefault()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [p.toggle, settingsOpen, view])

  const progress = p.totalMs > 0 ? 1 - p.remainingMs / p.totalMs : 0

  return (
    <div data-phase={phase} className="app min-h-dvh transition-colors duration-700">
      <main className="mx-auto flex w-full max-w-md flex-col gap-7 px-4 pt-5 pb-12 sm:pt-10">
        <header className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold tracking-tight text-ink">Pomodoro</h1>
          <ViewTabs view={view} onChange={setView} running={status === 'running'} />
          <div className="flex items-center">
            <IconButton
              label={p.muted ? 'Unmute sound' : 'Mute sound'}
              pressed={p.muted}
              onClick={() => p.setMuted(!p.muted)}
              testId="mute"
            >
              {p.muted ? <SpeakerOff /> : <SpeakerOn />}
            </IconButton>
            <IconButton label="Settings" onClick={() => setSettingsOpen(true)} testId="open-settings">
              <Gear />
            </IconButton>
          </div>
        </header>

        {view === 'stats' ? (
          <div id="panel-stats" role="tabpanel" aria-labelledby="tab-stats" data-testid="stats-view">
            <Stats log={p.log} />
          </div>
        ) : (
        <div id="panel-timer" role="tabpanel" aria-labelledby="tab-timer" className="flex flex-col gap-7" data-testid="timer-view">
        <section aria-label="Timer" className="flex flex-col items-center gap-5">
          <PhaseTabs phase={phase} />
          <Ring progress={progress}>
            <div
              data-testid="time"
              role="timer"
              aria-live="off"
              className="font-light tabular-nums tracking-tight text-ink text-[clamp(3.5rem,24vw,6rem)] sm:text-[5.25rem] leading-none"
            >
              {formatTime(p.remainingMs)}
            </div>
            <div className="mt-2 text-sm text-muted" data-testid="status">
              {status === 'running' ? (phase === 'focus' ? 'Stay with it' : 'Breathe') : status === 'paused' ? 'Paused' : 'Ready'}
            </div>
          </Ring>
          <CycleDots count={p.timer.cycleCount} />
        </section>

        <div className="flex items-center justify-center gap-3">
          <SecondaryButton onClick={p.reset} testId="reset" label="Reset">
            <ResetIcon /> <span>Reset</span>
          </SecondaryButton>
          <button
            type="button"
            data-testid="start-pause"
            onClick={p.toggle}
            className="h-14 min-w-36 rounded-full bg-accent px-8 text-lg font-medium text-white shadow-sm transition hover:brightness-105 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : 'Start'}
          </button>
          <SecondaryButton onClick={p.skip} testId="skip" label="Skip">
            <span>Skip</span> <SkipIcon />
          </SecondaryButton>
        </div>
        <p className="-mt-4 hidden text-center text-xs text-muted sm:block">
          Press <kbd className="rounded border border-line bg-card px-1.5 py-0.5 font-sans">Space</kbd> to start or pause
        </p>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">
            {phase === 'focus' ? 'What are you focusing on?' : 'Next focus task'}
          </span>
          <input
            data-testid="task"
            type="text"
            value={p.task}
            maxLength={80}
            onChange={(e) => p.setTask(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="Optional task label"
            className="w-full rounded-xl border border-line bg-card px-4 py-3 text-base text-ink placeholder:text-muted/70 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>

        <TodayLog entries={todaysEntries(p.log, Date.now())} />
        </div>
        )}
      </main>

      {settingsOpen && (
        <SettingsDialog
          settings={p.settings}
          onSave={(s) => {
            p.setSettings(s)
            setSettingsOpen(false)
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

function ViewTabs({ view, onChange, running }: { view: View; onChange: (v: View) => void; running: boolean }) {
  const views: { id: View; label: string }[] = [
    { id: 'timer', label: 'Timer' },
    { id: 'stats', label: 'Stats' },
  ]
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = view === 'timer' ? 'stats' : 'timer'
    onChange(next)
    document.getElementById(`tab-${next}`)?.focus()
  }
  return (
    <div role="tablist" aria-label="View" className="flex rounded-full bg-card/70 p-1 text-sm ring-1 ring-line" onKeyDown={onKeyDown}>
      {views.map((v) => {
        const selected = v.id === view
        return (
          <button
            key={v.id}
            id={`tab-${v.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${v.id}`}
            tabIndex={selected ? 0 : -1}
            data-testid={`tab-${v.id}`}
            onClick={() => onChange(v.id)}
            className={`relative rounded-full px-4 py-1.5 font-medium transition focus-visible:outline-2 focus-visible:outline-accent ${selected ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
          >
            {v.label}
            {v.id === 'timer' && running && !selected && (
              <>
                <span aria-hidden="true" data-testid="running-dot" className="absolute top-1 right-1.5 size-1.5 animate-pulse rounded-full bg-accent" />
                <span className="sr-only"> (running)</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

function PhaseTabs({ phase }: { phase: Phase }) {
  return (
    <div className="flex rounded-full bg-card/70 p-1 text-sm ring-1 ring-line" data-testid="phase" data-value={phase}>
      {(['focus', 'short', 'long'] as const).map((ph) => (
        <span
          key={ph}
          aria-current={ph === phase ? 'step' : undefined}
          className={`rounded-full px-3 py-1 transition ${ph === phase ? 'bg-accent text-white' : 'text-muted'}`}
        >
          {PHASE_LABEL[ph]}
        </span>
      ))}
    </div>
  )
}

function Ring({ progress, children }: { progress: number; children: React.ReactNode }) {
  const r = 46
  const c = 2 * Math.PI * r
  return (
    <div className="relative grid aspect-square w-[min(78vw,300px)] place-items-center">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
          className="transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <div className="relative flex flex-col items-center">{children}</div>
    </div>
  )
}

function CycleDots({ count }: { count: number }) {
  const filled = Math.min(count, SESSIONS_PER_CYCLE)
  return (
    <div className="flex flex-col items-center gap-2" data-testid="cycle" data-count={filled}>
      <div className="flex gap-2.5" aria-hidden="true">
        {Array.from({ length: SESSIONS_PER_CYCLE }, (_, i) => (
          <span
            key={i}
            data-filled={i < filled}
            className={`size-3 rounded-full transition ${i < filled ? 'bg-accent' : 'bg-transparent ring-1 ring-inset ring-muted/50'}`}
          />
        ))}
      </div>
      <span className="text-xs text-muted">
        {filled} of {SESSIONS_PER_CYCLE} {filled === SESSIONS_PER_CYCLE ? '· Recharge earned' : 'until Recharge'}
      </span>
    </div>
  )
}

function TodayLog({ entries }: { entries: LogEntry[] }) {
  const minutes = entries.reduce((sum, e) => sum + e.minutes, 0)
  return (
    <section aria-labelledby="log-heading" className="rounded-2xl bg-card p-4 ring-1 ring-line sm:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="log-heading" className="text-sm font-semibold text-ink">Today</h2>
        <span className="text-xs text-muted" data-testid="log-summary">
          {entries.length} {entries.length === 1 ? 'session' : 'sessions'} · {minutes} min
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="py-2 text-sm text-muted">Completed focus sessions will appear here.</p>
      ) : (
        <ul className="divide-y divide-line" data-testid="log">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm" data-testid="log-entry">
              <span className={`min-w-0 truncate ${e.task ? 'text-ink' : 'italic text-muted'}`}>{e.task || 'Untitled session'}</span>
              <span className="shrink-0 tabular-nums text-muted">{formatClock(e.finishedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const FIELDS: { key: keyof Settings; label: string }[] = [
  { key: 'focus', label: 'Focus' },
  { key: 'short', label: 'Short break' },
  { key: 'long', label: 'Recharge' },
]

function SettingsDialog({ settings, onSave, onClose }: { settings: Settings; onSave: (s: Settings) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [values, setValues] = useState<Record<keyof Settings, string>>({
    focus: String(settings.focus), short: String(settings.short), long: String(settings.long),
  })
  const errors = Object.fromEntries(FIELDS.map((f) => [f.key, validateMinutes(values[f.key])])) as Record<keyof Settings, string | null>
  const valid = FIELDS.every((f) => !errors[f.key])

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="settings-heading"
      data-testid="settings"
      className="m-auto w-[min(100vw-2rem,24rem)] rounded-2xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/30 backdrop:backdrop-blur-[2px]"
    >
      <form
        className="flex flex-col gap-4 p-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onSave({ focus: Number(values.focus), short: Number(values.short), long: Number(values.long) })
        }}
      >
        <div className="flex items-center justify-between">
          <h2 id="settings-heading" className="text-base font-semibold">Durations</h2>
          <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-sm text-muted hover:text-ink" aria-label="Close settings">✕</button>
        </div>
        <p className="-mt-2 text-sm text-muted">Minutes, between 1 and 90. A Recharge follows every 4 focus sessions.</p>
        {FIELDS.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{label}</span>
              <span className="flex items-center gap-2">
                <input
                  data-testid={`setting-${key}`}
                  type="text"
                  inputMode="numeric"
                  value={values[key]}
                  aria-invalid={!!errors[key]}
                  aria-describedby={errors[key] ? `err-${key}` : undefined}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  className={`w-20 rounded-lg border bg-white px-3 py-2 text-right text-base tabular-nums outline-none focus:ring-2 ${errors[key] ? 'border-red-400 focus:ring-red-200' : 'border-line focus:border-accent focus:ring-accent/20'}`}
                />
                <span className="w-7 text-sm text-muted">min</span>
              </span>
            </span>
            {errors[key] && <span id={`err-${key}`} data-testid={`error-${key}`} className="text-right text-xs text-red-600">{errors[key]}</span>}
          </label>
        ))}
        <div className="mt-1 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setValues({ focus: '25', short: '5', long: '15' })}
            className="rounded-full px-3 py-2 text-sm text-muted hover:text-ink"
          >
            Restore defaults
          </button>
          <button
            type="submit"
            data-testid="save-settings"
            disabled={!valid}
            className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </form>
    </dialog>
  )
}

function IconButton(props: { label: string; onClick: () => void; children: React.ReactNode; pressed?: boolean; testId: string }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      data-testid={props.testId}
      onClick={props.onClick}
      className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-card hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      {props.children}
    </button>
  )
}

function SecondaryButton(props: { label: string; onClick: () => void; children: React.ReactNode; testId: string }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      data-testid={props.testId}
      onClick={props.onClick}
      className="flex h-12 items-center gap-1.5 rounded-full bg-card px-4 text-sm font-medium text-ink ring-1 ring-line transition hover:ring-muted/50 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-accent"
    >
      {props.children}
    </button>
  )
}

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
const SpeakerOn = () => <svg {...svg}><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
const SpeakerOff = () => <svg {...svg}><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 6 6M22 9l-6 6" /></svg>
const Gear = () => <svg {...svg}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
const ResetIcon = () => <svg {...svg} width={16} height={16}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
const SkipIcon = () => <svg {...svg} width={16} height={16}><path d="m5 4 10 8-10 8z" /><path d="M19 5v14" /></svg>
