import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS as S,
  KEYS,
  type LogEntry,
  type TimerState,
  applySettings,
  formatTime,
  initialState,
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
  toggle,
  todaysLog,
  validateMinutes,
} from './timer'

const MIN = 60_000
const T0 = new Date(2026, 10, 9, 9, 0, 0).getTime()

function fakeStore() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

/** Run the current phase to completion and return the next state. */
function finish(st: TimerState, now = T0): TimerState {
  const running = start(st, now)
  const r = tick(running, S, running.endsAt!)
  expect(r.completed).not.toBeNull()
  return r.state
}

describe('durations and cycle', () => {
  it('starts as a 25 minute idle focus session', () => {
    const st = initialState(S)
    expect(st).toMatchObject({ phase: 'focus', status: 'idle', completedInCycle: 0 })
    expect(remaining(st, T0)).toBe(25 * MIN)
  })

  it('goes focus → short ×3, then long after the 4th focus, then a fresh cycle', () => {
    let st = initialState(S)
    const seen: string[] = []
    for (let i = 0; i < 9; i++) {
      st = finish(st)
      seen.push(`${st.phase}:${st.completedInCycle}:${remaining(st, T0) / MIN}`)
    }
    expect(seen).toEqual([
      'short:1:5', 'focus:1:25',
      'short:2:5', 'focus:2:25',
      'short:3:5', 'focus:3:25',
      'long:4:15', 'focus:0:25',
      'short:1:5',
    ])
  })

  it('does not auto-start the next phase', () => {
    expect(finish(initialState(S)).status).toBe('idle')
  })
})

describe('start / pause / reset / skip', () => {
  it('counts down from timestamps and pause freezes the remaining time', () => {
    let st = start(initialState(S), T0)
    expect(remaining(st, T0 + 10_000)).toBe(25 * MIN - 10_000)
    st = pause(st, T0 + 10_000)
    expect(st.status).toBe('paused')
    expect(remaining(st, T0 + 999_999)).toBe(25 * MIN - 10_000)
    st = start(st, T0 + 60_000)
    expect(remaining(st, T0 + 70_000)).toBe(25 * MIN - 20_000)
  })

  it('toggle alternates start and pause; start while running is a no-op', () => {
    let st = toggle(initialState(S), T0)
    expect(st.status).toBe('running')
    expect(start(st, T0 + 5000)).toBe(st)
    st = toggle(st, T0 + 5000)
    expect(st.status).toBe('paused')
  })

  it('reset restores the full phase length and stops', () => {
    const st = reset(pause(start(initialState(S), T0), T0 + 3 * MIN), S)
    expect(st.status).toBe('idle')
    expect(remaining(st, T0)).toBe(25 * MIN)
  })

  it('skipping focus goes to a break without counting the session', () => {
    const st = skip(start(initialState(S), T0), S)
    expect(st).toMatchObject({ phase: 'short', status: 'idle', completedInCycle: 0 })
  })

  it('skipping a short break goes to focus; skipping a long break starts a new cycle', () => {
    let st = finish(initialState(S))
    expect(skip(st, S)).toMatchObject({ phase: 'focus', completedInCycle: 1 })
    st = { ...initialState(S), completedInCycle: 3 }
    st = finish(st)
    expect(st.phase).toBe('long')
    expect(skip(st, S)).toMatchObject({ phase: 'focus', completedInCycle: 0 })
  })
})

describe('background accuracy', () => {
  it('a tick long after the end completes at the real end time, not at tick time', () => {
    const st = start(initialState(S), T0)
    const r = tick(st, S, T0 + 3 * 60 * MIN) // tab throttled/asleep for 3 hours
    expect(r.completed).toEqual({ phase: 'focus', endedAt: T0 + 25 * MIN })
    expect(r.state).toMatchObject({ phase: 'short', status: 'idle' })
  })

  it('a tick before the end changes nothing', () => {
    const st = start(initialState(S), T0)
    const r = tick(st, S, T0 + 25 * MIN - 1)
    expect(r.completed).toBeNull()
    expect(r.state).toBe(st)
  })

  it('remaining never goes below zero', () => {
    expect(remaining(start(initialState(S), T0), T0 + 99 * MIN)).toBe(0)
  })
})

describe('display', () => {
  it('formats mm:ss, rounding partial seconds up', () => {
    expect(formatTime(25 * MIN)).toBe('25:00')
    expect(formatTime(12 * MIN + 4000)).toBe('12:04')
    expect(formatTime(12 * MIN + 3001)).toBe('12:04')
    expect(formatTime(1)).toBe('00:01')
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(90 * MIN)).toBe('90:00')
  })

  it('builds the tab title from remaining time and phase', () => {
    const st = start(initialState(S), T0)
    expect(tabTitle(st, T0 + 25 * MIN - (12 * MIN + 4000))).toBe('12:04 - Focus')
    expect(tabTitle(finish(initialState(S)), T0)).toBe('05:00 - Short break')
    expect(tabTitle(finish({ ...initialState(S), completedInCycle: 3 }), T0)).toBe('15:00 - Recharge')
  })
})

describe('settings', () => {
  it('validates 1–90 whole minutes', () => {
    expect(validateMinutes('1')).toBeNull()
    expect(validateMinutes('90')).toBeNull()
    expect(validateMinutes(' 25 ')).toBeNull()
    expect(validateMinutes('0')).toMatch(/between/)
    expect(validateMinutes('91')).toMatch(/between/)
    expect(validateMinutes('')).toMatch(/Enter/)
    expect(validateMinutes('2.5')).toMatch(/whole/)
    expect(validateMinutes('-3')).toMatch(/whole/)
    expect(validateMinutes('abc')).toMatch(/whole/)
  })

  it('new durations apply to an idle phase but not to a running or paused one', () => {
    const s2 = { focus: 50, short: 10, long: 30 }
    expect(remaining(applySettings(initialState(S), s2), T0)).toBe(50 * MIN)
    const running = start(initialState(S), T0)
    expect(applySettings(running, s2)).toBe(running)
    const paused = pause(running, T0 + MIN)
    expect(applySettings(paused, s2)).toBe(paused)
  })

  it('custom durations drive the cycle', () => {
    const s2 = { focus: 1, short: 2, long: 3 }
    let st = initialState(s2)
    const r = tick(start(st, T0), s2, T0 + MIN)
    st = r.state
    expect(remaining(st, T0)).toBe(2 * MIN)
  })
})

describe('persistence', () => {
  it('round-trips settings and falls back per field on bad data', () => {
    const store = fakeStore()
    expect(loadSettings(store)).toEqual(S)
    saveSettings(store, { focus: 40, short: 7, long: 20 })
    expect(loadSettings(store)).toEqual({ focus: 40, short: 7, long: 20 })
    store.setItem(KEYS.settings, JSON.stringify({ focus: 0, short: 7, long: 'x' }))
    expect(loadSettings(store)).toEqual({ focus: 25, short: 7, long: 15 })
    store.setItem(KEYS.settings, '{not json')
    expect(loadSettings(store)).toEqual(S)
  })

  it('keeps the full history across days; the Today list filters to today', () => {
    const store = fakeStore()
    const yesterday: LogEntry = { id: 'a', task: 'old', finishedAt: T0 - 24 * 60 * MIN, minutes: 25 }
    const today: LogEntry = { id: 'b', task: 'write', finishedAt: T0 + MIN, minutes: 25 }
    saveLog(store, [yesterday, today])
    expect(loadLog(store)).toEqual([yesterday, today])
    expect(todaysLog(loadLog(store), T0)).toEqual([today])
    store.setItem(KEYS.log, JSON.stringify([today, { id: 1 }, null]))
    expect(loadLog(store)).toEqual([today]) // malformed entries dropped
    store.setItem(KEYS.log, '"nope"')
    expect(loadLog(store)).toEqual([])
  })

  it('restores a running timer so it keeps counting across a reload', () => {
    const store = fakeStore()
    const st = start(initialState(S), T0)
    saveTimer(store, st)
    const back = loadTimer(store, S)
    expect(remaining(back, T0 + 5 * MIN)).toBe(20 * MIN)
    expect(loadTimer(fakeStore(), S)).toEqual(initialState(S))
    store.setItem(KEYS.timer, JSON.stringify({ phase: 'nap' }))
    expect(loadTimer(store, S)).toEqual(initialState(S))
  })

  it('round-trips the mute flag', () => {
    const store = fakeStore()
    expect(loadMuted(store)).toBe(false)
    saveMuted(store, true)
    expect(loadMuted(store)).toBe(true)
  })

  it('survives a storage that throws', () => {
    const bad = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }
    expect(loadSettings(bad)).toEqual(S)
    expect(() => saveSettings(bad, S)).not.toThrow()
  })
})
