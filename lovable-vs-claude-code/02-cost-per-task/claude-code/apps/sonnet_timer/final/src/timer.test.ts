import { describe, expect, it } from 'vitest'
import * as T from './timer'

const S = T.DEFAULT_SETTINGS
const T0 = 1_000_000

describe('timer', () => {
  it('starts with 25 min focus', () => {
    const st = T.initialState(S)
    expect(st.remaining).toBe(25 * 60_000)
    expect(T.formatTime(st.remaining)).toBe('25:00')
  })
  it('is timestamp based: remaining derives from now, not tick count', () => {
    const st = T.start(T.initialState(S), T0)
    expect(T.remainingMs(st, T0 + 10 * 60_000)).toBe(15 * 60_000)
    expect(T.titleFor(st, T0 + 12 * 60_000 + 56_000)).toBe('12:04 - Focus')
  })
  it('pause freezes and resume continues', () => {
    let st = T.start(T.initialState(S), T0)
    st = T.pause(st, T0 + 60_000)
    expect(T.remainingMs(st, T0 + 999_999)).toBe(24 * 60_000)
    st = T.start(st, T0 + 500_000)
    expect(T.remainingMs(st, T0 + 500_000 + 1000)).toBe(24 * 60_000 - 1000)
  })
  it('reset restores full phase duration and stops', () => {
    let st = T.start(T.initialState(S), T0)
    st = T.reset(st, S)
    expect(st.endAt).toBeNull()
    expect(st.remaining).toBe(25 * 60_000)
  })
  it('does not finish early, finishes at endAt', () => {
    const st = T.start(T.initialState(S), T0)
    expect(T.tick(st, S, T0 + 25 * 60_000 - 1).finished).toBeNull()
    const r = T.tick(st, S, T0 + 25 * 60_000)
    expect(r.finished).toBe('focus')
    expect(r.state.phase).toBe('short')
    expect(r.state.endAt).toBeNull()
    expect(r.state.cycle).toBe(1)
  })
  it('Recharge (long break) after 4 focus sessions, then cycle resets', () => {
    let st = T.initialState(S)
    const phases: string[] = []
    for (let i = 0; i < 9; i++) {
      st = T.start(st, T0)
      st = T.tick(st, S, T0 + 90 * 60_000).state
      phases.push(st.phase)
    }
    expect(phases).toEqual(['short', 'focus', 'short', 'focus', 'short', 'focus', 'long', 'focus', 'short'])
  })
  it('dots track the cycle', () => {
    let st = T.initialState(S)
    expect(T.filledDots(st)).toBe(0)
    st = T.tick(T.start(st, 0), S, 1e9).state
    expect(T.filledDots(st)).toBe(1)
    st = { ...st, cycle: 4, phase: 'long' }
    expect(T.filledDots(st)).toBe(4)
    st = T.tick(T.start(st, 0), S, 1e9).state
    expect(T.filledDots(st)).toBe(0)
  })
  it('skip moves on without counting a focus session', () => {
    const st = T.skip(T.initialState(S), S)
    expect(st.phase).toBe('short')
    expect(st.cycle).toBe(0)
    expect(T.skip(st, S).phase).toBe('focus')
  })
  it('uses custom durations', () => {
    const s = { ...S, short: 7 }
    const st = T.tick(T.start(T.initialState(s), 0), s, 1e9).state
    expect(st.remaining).toBe(7 * 60_000)
  })
  it('formats time rounding up', () => {
    expect(T.formatTime(1)).toBe('00:01')
    expect(T.formatTime(0)).toBe('00:00')
    expect(T.formatTime(90 * 60_000)).toBe('90:00')
  })
})

describe('validation and storage', () => {
  it('parseMinutes accepts 1-90 integers only', () => {
    expect(T.parseMinutes('1')).toBe(1)
    expect(T.parseMinutes('90')).toBe(90)
    expect(T.parseMinutes(' 25 ')).toBe(25)
    for (const bad of ['0', '91', '', '-5', '2.5', 'abc', '1e1']) expect(T.parseMinutes(bad)).toBeNull()
  })
  it('sanitizeSettings falls back on bad data', () => {
    expect(T.sanitizeSettings(null)).toEqual(S)
    expect(T.sanitizeSettings({ focus: 50, short: 0, long: 'x', muted: true })).toEqual({ ...S, focus: 50, muted: true })
  })
  it('filters only entries from today', () => {
    const now = new Date(2025, 5, 10, 12).getTime()
    const log = [
      { id: 'a', label: '', minutes: 25, finishedAt: new Date(2025, 5, 9, 23, 59).getTime() },
      { id: 'b', label: 'x', minutes: 25, finishedAt: new Date(2025, 5, 10, 0, 1).getTime() },
    ]
    expect(T.todaysEntries(log, now).map((e) => e.id)).toEqual(['b'])
  })
  it('sanitizeLog drops junk', () => {
    expect(T.sanitizeLog('x')).toEqual([])
    expect(T.sanitizeLog([{ id: 'a', label: '', finishedAt: 1 }, { nope: 1 }, null])).toHaveLength(1)
  })
})
