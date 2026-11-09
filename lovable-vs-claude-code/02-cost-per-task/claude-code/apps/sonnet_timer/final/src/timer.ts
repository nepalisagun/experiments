export type Phase = 'focus' | 'short' | 'long'
export interface Settings { focus: number; short: number; long: number; muted: boolean }
export interface LogEntry { id: string; label: string; finishedAt: number; minutes: number }

export const DEFAULT_SETTINGS: Settings = { focus: 25, short: 5, long: 15, muted: false }
export const CYCLE = 4
export const PHASE_NAME: Record<Phase, string> = { focus: 'Focus', short: 'Short break', long: 'Recharge' }

export interface TimerState {
  phase: Phase
  /** timestamp (ms) when the running phase ends; null while paused/idle */
  endAt: number | null
  /** ms left while paused/idle */
  remaining: number
  /** focus sessions completed in the current cycle (0-3, or 4 during Recharge) */
  cycle: number
}

export const phaseMs = (s: Settings, p: Phase) => s[p] * 60_000

export function initialState(s: Settings): TimerState {
  return { phase: 'focus', endAt: null, remaining: phaseMs(s, 'focus'), cycle: 0 }
}

export const isRunning = (st: TimerState) => st.endAt !== null

export function remainingMs(st: TimerState, now: number) {
  return st.endAt === null ? st.remaining : Math.max(0, st.endAt - now)
}

export function start(st: TimerState, now: number): TimerState {
  if (isRunning(st)) return st
  return { ...st, endAt: now + st.remaining }
}

export function pause(st: TimerState, now: number): TimerState {
  if (!isRunning(st)) return st
  return { ...st, endAt: null, remaining: remainingMs(st, now) }
}

export function reset(st: TimerState, s: Settings): TimerState {
  return { ...st, endAt: null, remaining: phaseMs(s, st.phase) }
}

/** Move to the next phase (stopped, ready to start). */
export function advance(st: TimerState, s: Settings, completedFocus: boolean): TimerState {
  if (st.phase === 'focus') {
    const cycle = completedFocus ? st.cycle + 1 : st.cycle
    const phase: Phase = cycle >= CYCLE ? 'long' : 'short'
    return { phase, endAt: null, remaining: phaseMs(s, phase), cycle }
  }
  // after a break go back to focus; after Recharge the cycle starts over
  const cycle = st.phase === 'long' ? 0 : st.cycle
  return { phase: 'focus', endAt: null, remaining: phaseMs(s, 'focus'), cycle }
}

export function skip(st: TimerState, s: Settings): TimerState {
  return advance(st, s, false)
}

/** If the running phase has ended, move on. Returns the finished phase when it ended. */
export function tick(st: TimerState, s: Settings, now: number): { state: TimerState; finished: Phase | null } {
  if (st.endAt === null || now < st.endAt) return { state: st, finished: null }
  return { state: advance(st, s, true), finished: st.phase }
}

/** Dots filled toward Recharge. */
export const filledDots = (st: TimerState) => Math.min(st.cycle, CYCLE)

export function formatTime(ms: number) {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export const titleFor = (st: TimerState, now: number) =>
  `${formatTime(remainingMs(st, now))} - ${PHASE_NAME[st.phase]}`

/** Returns the whole-minute value if valid (integer 1-90), else null. */
export function parseMinutes(raw: string): number | null {
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= 90 ? n : null
}

export const dayKey = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export const todaysEntries = (log: LogEntry[], now: number) =>
  log.filter((e) => dayKey(e.finishedAt) === dayKey(now))

/** Settings loader tolerant of corrupt / partial data. */
export function sanitizeSettings(raw: unknown): Settings {
  const out = { ...DEFAULT_SETTINGS }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    for (const k of ['focus', 'short', 'long'] as const) {
      const v = r[k]
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 90) out[k] = v
    }
    if (typeof r.muted === 'boolean') out.muted = r.muted
  }
  return out
}

export function sanitizeLog(raw: unknown): LogEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (e) =>
        !!e && typeof e.id === 'string' && typeof e.label === 'string' && Number.isFinite(e.finishedAt),
    )
    .map((e) => ({
      id: e.id as string,
      label: e.label as string,
      finishedAt: e.finishedAt as number,
      // entries saved before minutes were recorded were all default-length sessions
      minutes: typeof e.minutes === 'number' && e.minutes > 0 ? e.minutes : DEFAULT_SETTINGS.focus,
    }))
}
