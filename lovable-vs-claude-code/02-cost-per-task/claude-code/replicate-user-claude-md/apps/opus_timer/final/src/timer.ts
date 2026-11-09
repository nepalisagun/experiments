// Pure Pomodoro logic: no React, no DOM. Time is always passed in as `now` (ms since epoch)
// so the countdown is derived from timestamps, never from counting ticks.

export type Phase = 'focus' | 'short' | 'long'
export type Status = 'idle' | 'running' | 'paused'

export interface Settings {
  focus: number // minutes
  short: number
  long: number
}

export const DEFAULT_SETTINGS: Settings = { focus: 25, short: 5, long: 15 }
export const SESSIONS_PER_CYCLE = 4
export const MIN_MINUTES = 1
export const MAX_MINUTES = 90

export interface TimerState {
  phase: Phase
  status: Status
  /** Timestamp when the running phase ends. Only meaningful while running. */
  endsAt: number | null
  /** Remaining time while idle or paused. */
  remainingMs: number
  /** Focus sessions completed in the current cycle (0..4). */
  completedInCycle: number
}

export interface LogEntry {
  id: string
  task: string
  finishedAt: number
  minutes: number
}

export const PHASE_LABEL: Record<Phase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Recharge', // the long break; the key stays `long` so saved settings keep loading
}

export function phaseMs(phase: Phase, s: Settings): number {
  return s[phase] * 60_000
}

export function initialState(s: Settings): TimerState {
  return { phase: 'focus', status: 'idle', endsAt: null, remainingMs: phaseMs('focus', s), completedInCycle: 0 }
}

export function remaining(state: TimerState, now: number): number {
  if (state.status === 'running' && state.endsAt !== null) return Math.max(0, state.endsAt - now)
  return state.remainingMs
}

export function start(state: TimerState, now: number): TimerState {
  if (state.status === 'running') return state
  return { ...state, status: 'running', endsAt: now + state.remainingMs }
}

export function pause(state: TimerState, now: number): TimerState {
  if (state.status !== 'running') return state
  return { ...state, status: 'paused', endsAt: null, remainingMs: remaining(state, now) }
}

export function toggle(state: TimerState, now: number): TimerState {
  return state.status === 'running' ? pause(state, now) : start(state, now)
}

/** Reset the current phase back to its full length, stopped. */
export function reset(state: TimerState, s: Settings): TimerState {
  return { ...state, status: 'idle', endsAt: null, remainingMs: phaseMs(state.phase, s) }
}

function enter(phase: Phase, completedInCycle: number, s: Settings): TimerState {
  return { phase, status: 'idle', endsAt: null, remainingMs: phaseMs(phase, s), completedInCycle }
}

/** The phase that follows a completed one. */
export function afterComplete(state: TimerState, s: Settings): TimerState {
  if (state.phase === 'focus') {
    const done = state.completedInCycle + 1
    return enter(done >= SESSIONS_PER_CYCLE ? 'long' : 'short', done, s)
  }
  return enter('focus', state.phase === 'long' ? 0 : state.completedInCycle, s)
}

/**
 * Skip the current phase. A skipped focus session is not logged and does not count toward
 * Recharge; a skipped Recharge still starts a fresh cycle.
 */
export function skip(state: TimerState, s: Settings): TimerState {
  if (state.phase === 'focus') {
    return enter(state.completedInCycle >= SESSIONS_PER_CYCLE ? 'long' : 'short', state.completedInCycle, s)
  }
  return enter('focus', state.phase === 'long' ? 0 : state.completedInCycle, s)
}

export interface TickResult {
  state: TimerState
  /** Set when a phase just finished: which one and when it actually ended. */
  completed: { phase: Phase; endedAt: number } | null
}

/**
 * Advance the timer to `now`. If the running phase ran out (even long ago, e.g. while the tab
 * was in the background or closed), it completes at its real end time and the next phase waits idle.
 */
export function tick(state: TimerState, s: Settings, now: number): TickResult {
  if (state.status !== 'running' || state.endsAt === null || now < state.endsAt) return { state, completed: null }
  return { state: afterComplete(state, s), completed: { phase: state.phase, endedAt: state.endsAt } }
}

/** When settings change, an untouched (idle) phase picks up its new length. */
export function applySettings(state: TimerState, s: Settings): TimerState {
  return state.status === 'idle' ? { ...state, remainingMs: phaseMs(state.phase, s) } : state
}

/** mm:ss, rounding up so a fresh 25-minute session shows 25:00 and it reads 00:00 only at the end. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const sec = total % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function tabTitle(state: TimerState, now: number): string {
  return `${formatTime(remaining(state, now))} - ${PHASE_LABEL[state.phase]}`
}

/** Validate one duration field. Returns an error message, or null when valid. */
export function validateMinutes(raw: string): string | null {
  const t = raw.trim()
  if (t === '') return 'Enter a number of minutes.'
  if (!/^\d+$/.test(t)) return 'Use whole minutes.'
  const n = Number(t)
  if (n < MIN_MINUTES || n > MAX_MINUTES) return `Must be between ${MIN_MINUTES} and ${MAX_MINUTES}.`
  return null
}

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function todaysLog(log: LogEntry[], now: number): LogEntry[] {
  const today = dayKey(now)
  return log.filter((e) => dayKey(e.finishedAt) === today)
}

// ---- localStorage persistence (storage is injected so tests can pass a fake) ----

export const KEYS = { settings: 'pomodoro.settings', log: 'pomodoro.log', timer: 'pomodoro.timer', muted: 'pomodoro.muted' }

type Store = Pick<Storage, 'getItem' | 'setItem'>

function read(store: Store, key: string): unknown {
  try {
    const raw = store.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function write(store: Store, key: string, value: unknown) {
  try {
    store.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: the app keeps working in memory
  }
}

const validMin = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= MIN_MINUTES && v <= MAX_MINUTES

export function loadSettings(store: Store): Settings {
  const v = read(store, KEYS.settings) as Partial<Settings> | null
  if (!v || typeof v !== 'object') return { ...DEFAULT_SETTINGS }
  return {
    focus: validMin(v.focus) ? v.focus! : DEFAULT_SETTINGS.focus,
    short: validMin(v.short) ? v.short! : DEFAULT_SETTINGS.short,
    long: validMin(v.long) ? v.long! : DEFAULT_SETTINGS.long,
  }
}

export const saveSettings = (store: Store, s: Settings) => write(store, KEYS.settings, s)

/** The full history of completed focus sessions (every day, kept for Stats and export). */
export function loadLog(store: Store): LogEntry[] {
  const v = read(store, KEYS.log)
  if (!Array.isArray(v)) return []
  return v.filter(
    (e): e is LogEntry =>
      e && typeof e.id === 'string' && typeof e.task === 'string' && typeof e.finishedAt === 'number' && typeof e.minutes === 'number',
  )
}

export const saveLog = (store: Store, log: LogEntry[]) => write(store, KEYS.log, log)

export function loadTimer(store: Store, s: Settings): TimerState {
  const v = read(store, KEYS.timer) as TimerState | null
  const phases: Phase[] = ['focus', 'short', 'long']
  const statuses: Status[] = ['idle', 'running', 'paused']
  if (
    !v ||
    !phases.includes(v.phase) ||
    !statuses.includes(v.status) ||
    typeof v.remainingMs !== 'number' ||
    typeof v.completedInCycle !== 'number' ||
    (v.status === 'running' && typeof v.endsAt !== 'number')
  ) {
    return initialState(s)
  }
  return {
    phase: v.phase,
    status: v.status,
    endsAt: v.status === 'running' ? v.endsAt : null,
    remainingMs: Math.max(0, Math.min(v.remainingMs, phaseMs(v.phase, s))),
    completedInCycle: Math.max(0, Math.min(SESSIONS_PER_CYCLE, Math.floor(v.completedInCycle))),
  }
}

export const saveTimer = (store: Store, t: TimerState) => write(store, KEYS.timer, t)

export function loadMuted(store: Store): boolean {
  return read(store, KEYS.muted) === true
}

export const saveMuted = (store: Store, m: boolean) => write(store, KEYS.muted, m)
