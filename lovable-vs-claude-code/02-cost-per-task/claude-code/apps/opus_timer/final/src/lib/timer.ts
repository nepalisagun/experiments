// Pure Pomodoro timer logic. All time math is based on wall-clock timestamps
// (`now` in ms), never on counting ticks, so the timer stays accurate when the
// tab is throttled in the background.

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
  /** Timestamp the current phase ends at; only set while running. */
  endsAt: number | null
  /** Remaining ms while idle or paused. */
  remainingMs: number
  /** Focus sessions completed in the current cycle (0..4). */
  cycleCount: number
}

export const PHASE_LABEL: Record<Phase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Recharge',
}

export function durationMs(phase: Phase, settings: Settings): number {
  return settings[phase] * 60_000
}

export function initialState(settings: Settings): TimerState {
  return { phase: 'focus', status: 'idle', endsAt: null, remainingMs: durationMs('focus', settings), cycleCount: 0 }
}

export function getRemainingMs(state: TimerState, now: number): number {
  if (state.status === 'running' && state.endsAt !== null) return Math.max(0, state.endsAt - now)
  return Math.max(0, state.remainingMs)
}

export function start(state: TimerState, now: number): TimerState {
  if (state.status === 'running') return state
  return { ...state, status: 'running', endsAt: now + state.remainingMs }
}

export function pause(state: TimerState, now: number): TimerState {
  if (state.status !== 'running') return state
  return { ...state, status: 'paused', endsAt: null, remainingMs: getRemainingMs(state, now) }
}

export function toggle(state: TimerState, now: number): TimerState {
  return state.status === 'running' ? pause(state, now) : start(state, now)
}

/** Stop and restore the full duration of the current phase. */
export function reset(state: TimerState, settings: Settings): TimerState {
  return { ...state, status: 'idle', endsAt: null, remainingMs: durationMs(state.phase, settings) }
}

/** Which phase follows the current one. `completed` = focus finished naturally. */
export function nextPhase(state: TimerState, completed: boolean): { phase: Phase; cycleCount: number } {
  if (state.phase === 'focus') {
    if (!completed) return { phase: 'short', cycleCount: state.cycleCount }
    const count = state.cycleCount + 1
    return { phase: count >= SESSIONS_PER_CYCLE ? 'long' : 'short', cycleCount: count }
  }
  // After a Recharge a new cycle begins.
  return { phase: 'focus', cycleCount: state.phase === 'long' ? 0 : state.cycleCount }
}

function moveTo(state: TimerState, settings: Settings, completed: boolean): TimerState {
  const { phase, cycleCount } = nextPhase(state, completed)
  return { phase, cycleCount, status: 'idle', endsAt: null, remainingMs: durationMs(phase, settings) }
}

/** Skip to the next phase. A skipped focus session does not count toward the Recharge. */
export function skip(state: TimerState, settings: Settings): TimerState {
  return moveTo(state, settings, false)
}

export interface TickResult {
  state: TimerState
  /** Set when the running phase just finished. */
  ended: { phase: Phase; at: number } | null
}

/** Advance the state to `now`. If the running phase has ended, move to the next (idle) phase. */
export function tick(state: TimerState, settings: Settings, now: number): TickResult {
  if (state.status !== 'running' || state.endsAt === null || now < state.endsAt) return { state, ended: null }
  return { state: moveTo(state, settings, true), ended: { phase: state.phase, at: state.endsAt } }
}

/** When settings change, an idle timer picks up the new duration immediately. */
export function applySettings(state: TimerState, settings: Settings): TimerState {
  if (state.status !== 'idle') return state
  return { ...state, remainingMs: durationMs(state.phase, settings) }
}

export function formatTime(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatTitle(state: TimerState, now: number): string {
  return `${formatTime(getRemainingMs(state, now))} - ${PHASE_LABEL[state.phase]}`
}

/** Validate a minutes value typed by the user. Returns an error message or null. */
export function validateMinutes(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return 'Required'
  if (!/^\d+$/.test(trimmed)) return 'Whole minutes only'
  const n = Number(trimmed)
  if (n < MIN_MINUTES || n > MAX_MINUTES) return `Must be ${MIN_MINUTES}–${MAX_MINUTES}`
  return null
}

export function sanitizeSettings(value: unknown): Settings {
  const out = { ...DEFAULT_SETTINGS }
  if (value && typeof value === 'object') {
    for (const key of ['focus', 'short', 'long'] as const) {
      const v = (value as Record<string, unknown>)[key]
      if (typeof v === 'number' && Number.isInteger(v) && v >= MIN_MINUTES && v <= MAX_MINUTES) out[key] = v
    }
  }
  return out
}

export function sanitizeTimer(value: unknown, settings: Settings): TimerState {
  const fallback = initialState(settings)
  if (!value || typeof value !== 'object') return fallback
  const v = value as Partial<TimerState>
  const phases: Phase[] = ['focus', 'short', 'long']
  const statuses: Status[] = ['idle', 'running', 'paused']
  if (!phases.includes(v.phase as Phase) || !statuses.includes(v.status as Status)) return fallback
  const cycleCount = typeof v.cycleCount === 'number' ? Math.min(SESSIONS_PER_CYCLE, Math.max(0, Math.floor(v.cycleCount))) : 0
  const max = durationMs(v.phase as Phase, settings)
  if (v.status === 'running') {
    if (typeof v.endsAt !== 'number') return { ...fallback, phase: v.phase as Phase, cycleCount, remainingMs: max }
    const remainingMs = typeof v.remainingMs === 'number' ? v.remainingMs : max
    return { phase: v.phase as Phase, status: 'running', endsAt: v.endsAt, remainingMs, cycleCount }
  }
  const remainingMs = typeof v.remainingMs === 'number' && v.remainingMs > 0 ? Math.min(v.remainingMs, max) : max
  return { phase: v.phase as Phase, status: v.status as Status, endsAt: null, remainingMs, cycleCount }
}
