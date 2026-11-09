import { describe, expect, it } from 'vitest'
import {
  applySettings, DEFAULT_SETTINGS as S, formatTime, formatTitle, getRemainingMs, initialState, pause,
  reset, sanitizeSettings, sanitizeTimer, skip, start, tick, toggle, validateMinutes, type TimerState,
} from './timer'
import { addEntry, sanitizeHistory, todaysEntries } from './log'

const MIN = 60_000
const T0 = new Date(2026, 10, 9, 9, 0, 0).getTime()

/** Run a full phase to completion starting at `now`; returns state and end time. */
function runOut(state: TimerState, now: number) {
  const running = start(state, now)
  const end = running.endsAt!
  return { ...tick(running, S, end), now: end }
}

describe('durations and cycle', () => {
  it('starts with a 25 minute focus session', () => {
    const s = initialState(S)
    expect(s.phase).toBe('focus')
    expect(getRemainingMs(s, T0)).toBe(25 * MIN)
  })

  it('goes focus → short ×3, then long after the 4th focus, then back to focus with a fresh cycle', () => {
    let s = initialState(S)
    let now = T0
    const phases: string[] = []
    const counts: number[] = []
    for (let i = 0; i < 8; i++) {
      const r = runOut(s, now)
      s = r.state
      now = r.now
      phases.push(s.phase)
      counts.push(s.cycleCount)
      expect(getRemainingMs(s, now)).toBe(S[s.phase] * MIN)
    }
    expect(phases).toEqual(['short', 'focus', 'short', 'focus', 'short', 'focus', 'long', 'focus'])
    expect(counts).toEqual([1, 1, 2, 2, 3, 3, 4, 0])
  })

  it('reports the ended phase with its exact end timestamp', () => {
    const running = start(initialState(S), T0)
    expect(tick(running, S, T0 + 25 * MIN - 1).ended).toBeNull()
    const r = tick(running, S, T0 + 25 * MIN + 5000)
    expect(r.ended).toEqual({ phase: 'focus', at: T0 + 25 * MIN })
    expect(r.state.status).toBe('idle')
  })

  it('the next phase waits for Start (does not auto-run)', () => {
    const r = runOut(initialState(S), T0)
    expect(r.state.status).toBe('idle')
    expect(tick(r.state, S, r.now + 60 * MIN).ended).toBeNull()
  })
})

describe('start / pause / reset / skip', () => {
  it('is timestamp-based: remaining time follows the clock regardless of tick count', () => {
    const s = start(initialState(S), T0)
    // No ticks at all for 10 minutes (e.g. a throttled background tab).
    expect(getRemainingMs(s, T0 + 10 * MIN + 30_000)).toBe(14 * MIN + 30_000)
    expect(formatTime(getRemainingMs(s, T0 + 10 * MIN + 30_000))).toBe('14:30')
  })

  it('pause freezes the remaining time and resume continues from it', () => {
    let s = start(initialState(S), T0)
    s = pause(s, T0 + 5 * MIN)
    expect(s.status).toBe('paused')
    expect(getRemainingMs(s, T0 + 50 * MIN)).toBe(20 * MIN)
    s = start(s, T0 + 50 * MIN)
    expect(getRemainingMs(s, T0 + 51 * MIN)).toBe(19 * MIN)
    expect(s.endsAt).toBe(T0 + 70 * MIN)
  })

  it('toggle alternates start and pause; start while running is a no-op', () => {
    let s = toggle(initialState(S), T0)
    expect(s.status).toBe('running')
    expect(start(s, T0 + MIN)).toBe(s)
    s = toggle(s, T0 + MIN)
    expect(s.status).toBe('paused')
    expect(pause(s, T0 + 2 * MIN)).toBe(s)
  })

  it('reset stops and restores the full duration of the current phase', () => {
    let s = runOut(initialState(S), T0).state // short break
    s = start(s, T0)
    s = reset(s, S)
    expect(s).toMatchObject({ phase: 'short', status: 'idle', endsAt: null, remainingMs: 5 * MIN, cycleCount: 1 })
  })

  it('skipping focus goes to a short break without counting the session', () => {
    const s = skip(start(initialState(S), T0), S)
    expect(s).toMatchObject({ phase: 'short', status: 'idle', cycleCount: 0, remainingMs: 5 * MIN })
  })

  it('skipping a break goes to focus; skipping a Recharge resets the cycle', () => {
    const shortB: TimerState = { phase: 'short', status: 'running', endsAt: T0, remainingMs: 0, cycleCount: 2 }
    expect(skip(shortB, S)).toMatchObject({ phase: 'focus', cycleCount: 2, remainingMs: 25 * MIN })
    const longB: TimerState = { ...shortB, phase: 'long', cycleCount: 4 }
    expect(skip(longB, S)).toMatchObject({ phase: 'focus', cycleCount: 0 })
  })
})

describe('settings', () => {
  it('validates 1–90 whole minutes', () => {
    expect(validateMinutes('1')).toBeNull()
    expect(validateMinutes('90')).toBeNull()
    expect(validateMinutes(' 25 ')).toBeNull()
    expect(validateMinutes('0')).not.toBeNull()
    expect(validateMinutes('91')).not.toBeNull()
    expect(validateMinutes('')).not.toBeNull()
    expect(validateMinutes('2.5')).not.toBeNull()
    expect(validateMinutes('-3')).not.toBeNull()
    expect(validateMinutes('abc')).not.toBeNull()
  })

  it('custom durations drive the timer', () => {
    const custom = { focus: 50, short: 10, long: 30 }
    const s = initialState(custom)
    expect(s.remainingMs).toBe(50 * MIN)
    expect(tick(start(s, T0), custom, T0 + 50 * MIN).state.remainingMs).toBe(10 * MIN)
  })

  it('applies new durations to an idle timer but not a running or paused one', () => {
    const custom = { ...S, focus: 40 }
    expect(applySettings(initialState(S), custom).remainingMs).toBe(40 * MIN)
    const paused = pause(start(initialState(S), T0), T0 + MIN)
    expect(applySettings(paused, custom).remainingMs).toBe(24 * MIN)
  })

  it('sanitizes stored settings', () => {
    expect(sanitizeSettings(undefined)).toEqual(S)
    expect(sanitizeSettings({ focus: 45, short: 0, long: 'x' })).toEqual({ focus: 45, short: 5, long: 15 })
  })

  it('restores a stored running timer, rejecting garbage', () => {
    const running = start(initialState(S), T0)
    expect(sanitizeTimer(JSON.parse(JSON.stringify(running)), S)).toEqual(running)
    expect(sanitizeTimer({ phase: 'nope' }, S)).toEqual(initialState(S))
    expect(sanitizeTimer(null, S)).toEqual(initialState(S))
  })
})

describe('display', () => {
  it('formats mm:ss rounding up partial seconds', () => {
    expect(formatTime(25 * MIN)).toBe('25:00')
    expect(formatTime(724_000)).toBe('12:04')
    expect(formatTime(723_001)).toBe('12:04')
    expect(formatTime(500)).toBe('00:01')
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(90 * MIN)).toBe('90:00')
  })

  it('builds the tab title as "mm:ss - Phase"', () => {
    const s = start(initialState(S), T0)
    expect(formatTitle(s, T0 + 25 * MIN - 724_000)).toBe('12:04 - Focus')
    expect(formatTitle({ ...initialState(S), phase: 'short', remainingMs: 5 * MIN }, T0)).toBe('05:00 - Short break')
  })
})

describe('session history and today\'s log', () => {
  it('keeps sessions from every day; today\'s log shows only today, newest first', () => {
    const yesterday = T0 - 24 * 60 * MIN
    let log = sanitizeHistory([{ id: 'old', task: 'old', finishedAt: yesterday, minutes: 25 }])
    expect(log).toHaveLength(1) // history is no longer pruned
    log = addEntry(log, { task: 'Write', finishedAt: T0, minutes: 25 })
    log = addEntry(log, { task: '', finishedAt: T0 + 30 * MIN, minutes: 25 })
    expect(log.map((e) => e.task)).toEqual(['old', 'Write', ''])
    expect(new Set(log.map((e) => e.id)).size).toBe(3)
    expect(todaysEntries(log, T0 + 31 * MIN).map((e) => e.task)).toEqual(['', 'Write'])
    // After midnight today's list empties, but the history keeps everything.
    expect(todaysEntries(log, T0 + 24 * 60 * MIN)).toEqual([])
    expect(log).toHaveLength(3)
  })

  it('drops malformed stored entries and sorts the rest oldest first', () => {
    expect(sanitizeHistory('x')).toEqual([])
    const ok = (id: string, finishedAt: number) => ({ id, task: 't', finishedAt, minutes: 25 })
    const out = sanitizeHistory([{ id: 1 }, null, { ...ok('z', T0), minutes: 0 }, ok('b', T0 + 1), ok('a', T0)])
    expect(out.map((e) => e.id)).toEqual(['a', 'b'])
  })
})
