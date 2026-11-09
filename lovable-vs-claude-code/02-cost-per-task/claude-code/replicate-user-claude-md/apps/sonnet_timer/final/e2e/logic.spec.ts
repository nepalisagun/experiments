import { test, expect } from '@playwright/test'
import {
  DEFAULT_SETTINGS as S,
  applySettings,
  dayKey,
  formatTime,
  initialState,
  parseMinutes,
  pause,
  remaining,
  reset,
  sanitizeLog,
  sanitizeSettings,
  skip,
  start,
  tabTitle,
  tick,
  todaysEntries,
  type TimerState,
} from '../src/timer'

const T0 = 1_000_000

function finishPhase(st: TimerState) {
  const s = start(st, T0)
  return tick(s, S, s.endAt!)
}

test('defaults: 25 / 5 / 15', () => {
  expect([S.focus, S.short, S.long]).toEqual([25, 5, 15])
  expect(initialState(S).remainingMs).toBe(25 * 60_000)
})

test('formatTime and tab title', () => {
  expect(formatTime(25 * 60_000)).toBe('25:00')
  expect(formatTime(724_000)).toBe('12:04')
  expect(formatTime(500)).toBe('00:01')
  expect(formatTime(0)).toBe('00:00')
  const st = start(initialState(S), T0)
  expect(tabTitle(st, T0 + 25 * 60_000 - 724_000)).toBe('12:04 - Focus')
  expect(tabTitle(initialState(S, 'short'), T0)).toBe('05:00 - Short break')
})

test('timer is timestamp based: elapsed wall time counts even with no ticks', () => {
  const st = start(initialState(S), T0)
  expect(remaining(st, T0 + 10 * 60_000)).toBe(15 * 60_000)
  // a single late tick after 30 min completes the phase
  const r = tick(st, S, T0 + 30 * 60_000)
  expect(r.finished?.phase).toBe('focus')
})

test('pause keeps remaining time, resume continues from it', () => {
  let st = start(initialState(S), T0)
  st = pause(st, T0 + 60_000)
  expect(st.status).toBe('paused')
  expect(remaining(st, T0 + 999_999)).toBe(24 * 60_000)
  st = start(st, T0 + 5 * 60_000)
  expect(remaining(st, T0 + 5 * 60_000 + 1000)).toBe(24 * 60_000 - 1000)
})

test('reset restores full duration of the current phase and stops', () => {
  let st = start(initialState(S), T0)
  st = pause(st, T0 + 100_000)
  st = reset(st, S)
  expect(st.status).toBe('idle')
  expect(st.remainingMs).toBe(25 * 60_000)
})

test('a full cycle: 4 focus sessions then a long break, then dots clear', () => {
  let st = initialState(S)
  const seq: string[] = []
  for (let i = 0; i < 4; i++) {
    const r = finishPhase(st)
    expect(r.finished?.phase).toBe('focus')
    st = r.state
    seq.push(st.phase + ':' + st.cycle)
    if (i < 3) st = finishPhase(st).state // finish the short break
  }
  expect(seq).toEqual(['short:1', 'short:2', 'short:3', 'long:4'])
  expect(st.remainingMs).toBe(15 * 60_000)
  st = finishPhase(st).state // long break ends
  expect(st.phase).toBe('focus')
  expect(st.cycle).toBe(0)
})

test('finishing a break does not report a focus completion', () => {
  const r = finishPhase(initialState(S, 'short'))
  expect(r.finished?.phase).toBe('short')
  expect(r.state.phase).toBe('focus')
})

test('tick before the end changes nothing', () => {
  const st = start(initialState(S), T0)
  expect(tick(st, S, T0 + 1000).state).toBe(st)
  expect(tick(initialState(S), S, T0 + 1e9).finished).toBeNull()
})

test('skip: focus -> short break without counting; breaks -> focus', () => {
  const a = skip(initialState(S, 'focus', 2), S)
  expect([a.phase, a.cycle, a.status]).toEqual(['short', 2, 'idle'])
  const b = skip(initialState(S, 'short', 2), S)
  expect([b.phase, b.cycle]).toEqual(['focus', 2])
  const c = skip(initialState(S, 'long', 4), S)
  expect([c.phase, c.cycle]).toEqual(['focus', 0])
})

test('settings validation 1-90 whole minutes', () => {
  expect(parseMinutes('1')).toBe(1)
  expect(parseMinutes('90')).toBe(90)
  expect(parseMinutes(' 45 ')).toBe(45)
  for (const bad of ['0', '91', '-5', '', 'abc', '2.5', '1e1', '  ']) expect(parseMinutes(bad)).toBeNull()
})

test('applySettings updates an idle phase but not a running one', () => {
  const next = { ...S, focus: 50 }
  expect(applySettings(initialState(S), next).remainingMs).toBe(50 * 60_000)
  const running = start(initialState(S), T0)
  expect(applySettings(running, next)).toBe(running)
})

test('sanitizeSettings falls back to defaults on corrupt data', () => {
  expect(sanitizeSettings(null)).toEqual(S)
  expect(sanitizeSettings({ focus: 500, short: 'x', long: 20, muted: true })).toEqual({ ...S, long: 20, muted: true })
})

test('log: only today is kept; junk is dropped', () => {
  const now = new Date(2026, 10, 9, 15, 0).getTime()
  const yesterday = new Date(2026, 10, 8, 23, 59).getTime()
  const log = [
    { id: 'a', task: 'x', finishedAt: now - 3600_000, minutes: 25 },
    { id: 'b', task: 'y', finishedAt: yesterday, minutes: 25 },
  ]
  expect(todaysEntries(log, now).map((e) => e.id)).toEqual(['a'])
  expect(dayKey(now)).not.toBe(dayKey(yesterday))
  expect(sanitizeLog([{ id: 1 }, null, log[0]])).toEqual([log[0]])
  expect(sanitizeLog('nope')).toEqual([])
})
