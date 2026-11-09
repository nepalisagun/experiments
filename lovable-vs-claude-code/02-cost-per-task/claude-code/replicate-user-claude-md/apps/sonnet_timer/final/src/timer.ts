export type Phase = 'focus' | 'short' | 'long'
export type Status = 'idle' | 'running' | 'paused'

export interface Settings {
  focus: number // minutes
  short: number
  long: number
  muted: boolean
}

export interface TimerState {
  phase: Phase
  status: Status
  /** ms left; authoritative while idle/paused */
  remainingMs: number
  /** wall-clock ms timestamp when the phase ends; authoritative while running */
  endAt: number | null
  /** focus sessions completed toward the long break (0..4) */
  cycle: number
}

export interface LogEntry {
  id: string
  task: string
  finishedAt: number
  /** length of the focus session in minutes */
  minutes: number
}

export const CYCLE_LENGTH = 4
export const MIN_MINUTES = 1
export const MAX_MINUTES = 90
export const DEFAULT_SETTINGS: Settings = { focus: 25, short: 5, long: 15, muted: false }

export const PHASE_LABEL: Record<Phase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Recharge',
}

export function phaseMs(phase: Phase, s: Settings): number {
  return s[phase] * 60_000
}

export function initialState(s: Settings, phase: Phase = 'focus', cycle = 0): TimerState {
  return { phase, status: 'idle', remainingMs: phaseMs(phase, s), endAt: null, cycle }
}

export function remaining(st: TimerState, now: number): number {
  if (st.status === 'running' && st.endAt !== null) return Math.max(0, st.endAt - now)
  return st.remainingMs
}

export function start(st: TimerState, now: number): TimerState {
  if (st.status === 'running') return st
  return { ...st, status: 'running', endAt: now + st.remainingMs }
}

export function pause(st: TimerState, now: number): TimerState {
  if (st.status !== 'running') return st
  return { ...st, status: 'paused', remainingMs: remaining(st, now), endAt: null }
}

export function toggle(st: TimerState, now: number): TimerState {
  return st.status === 'running' ? pause(st, now) : start(st, now)
}

/** Restart the current phase from its full duration (stopped). */
export function reset(st: TimerState, s: Settings): TimerState {
  return initialState(s, st.phase, st.cycle)
}

/** What follows `phase` once `cycle` focus sessions are counted. */
function nextAfter(phase: Phase, cycle: number): { phase: Phase; cycle: number } {
  if (phase === 'focus') {
    return cycle >= CYCLE_LENGTH ? { phase: 'long', cycle } : { phase: 'short', cycle }
  }
  // after any break: back to focus; a long break closes the cycle
  return { phase: 'focus', cycle: phase === 'long' ? 0 : cycle }
}

/**
 * Skip to the next phase. A skipped focus session is not counted (no dot, no log),
 * so it always leads to a short break; skipping a break goes to focus.
 */
export function skip(st: TimerState, s: Settings): TimerState {
  if (st.phase === 'focus') return initialState(s, 'short', st.cycle)
  const n = nextAfter(st.phase, st.cycle)
  return initialState(s, n.phase, n.cycle)
}

export interface TickResult {
  state: TimerState
  /** set when a phase just finished */
  finished: { phase: Phase } | null
}

/** Advance the clock: completes the phase if its end time has passed. */
export function tick(st: TimerState, s: Settings, now: number): TickResult {
  if (st.status !== 'running' || st.endAt === null || now < st.endAt) {
    return { state: st, finished: null }
  }
  const cycle = st.phase === 'focus' ? Math.min(st.cycle + 1, CYCLE_LENGTH) : st.cycle
  const n = nextAfter(st.phase, cycle)
  return { state: initialState(s, n.phase, n.cycle), finished: { phase: st.phase } }
}

/** Apply new settings: an untouched (idle) phase picks up its new length immediately. */
export function applySettings(st: TimerState, s: Settings): TimerState {
  return st.status === 'idle' ? { ...st, remainingMs: phaseMs(st.phase, s) } : st
}

export function formatTime(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0')
}

export function tabTitle(st: TimerState, now: number): string {
  return formatTime(remaining(st, now)) + ' - ' + PHASE_LABEL[st.phase]
}

/** Returns an integer 1..90 or null when invalid. */
export function parseMinutes(raw: string): number | null {
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= MIN_MINUTES && n <= MAX_MINUTES ? n : null
}

export function dayKey(ts: number): string {
  const d = new Date(ts)
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-')
}

export function todaysEntries(log: LogEntry[], now: number): LogEntry[] {
  const k = dayKey(now)
  return log.filter((e) => dayKey(e.finishedAt) === k)
}

export function sanitizeSettings(raw: unknown): Settings {
  const out = { ...DEFAULT_SETTINGS }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    for (const k of ['focus', 'short', 'long'] as const) {
      const v = r[k]
      if (typeof v === 'number' && Number.isInteger(v) && v >= MIN_MINUTES && v <= MAX_MINUTES) out[k] = v
    }
    if (typeof r.muted === 'boolean') out.muted = r.muted
  }
  return out
}

export function sanitizeLog(raw: unknown): LogEntry[] {
  if (!Array.isArray(raw)) return []
  const out: LogEntry[] = []
  for (const e of raw) {
    if (!e || typeof e.id !== 'string' || typeof e.task !== 'string') continue
    if (typeof e.finishedAt !== 'number' || !Number.isFinite(e.finishedAt)) continue
    // entries saved before minutes were recorded get the default focus length
    const minutes =
      typeof e.minutes === 'number' && Number.isFinite(e.minutes) && e.minutes > 0 ? e.minutes : DEFAULT_SETTINGS.focus
    out.push({ id: e.id, task: e.task, finishedAt: e.finishedAt, minutes })
  }
  return out
}
