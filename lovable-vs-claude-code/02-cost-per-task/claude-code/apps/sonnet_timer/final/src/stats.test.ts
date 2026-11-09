import { describe, expect, it } from 'vitest'
import * as S from './stats'
import { sanitizeLog } from './timer'
import type { LogEntry } from './timer'

const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const NOW = at(2026, 6, 1, 9)
let n = 0
const entry = (ts: number, minutes = 25, label = ''): LogEntry => ({ id: `e${n++}`, label, finishedAt: ts, minutes })

describe('lastSevenDays', () => {
  it('returns 7 consecutive days ending today, oldest first, zero-filled', () => {
    const days = S.lastSevenDays([], NOW)
    expect(days.map((d) => S.isoDate(d.date.getTime()))).toEqual([
      '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30', '2026-05-31', '2026-06-01',
    ])
    expect(days.every((d) => d.minutes === 0)).toBe(true)
    expect(days.filter((d) => d.isToday)).toHaveLength(1)
    expect(days[6].isToday).toBe(true)
  })
  it('sums minutes per day and ignores entries outside the window', () => {
    const log = [
      entry(at(2026, 6, 1, 8)), entry(at(2026, 6, 1, 8, 30), 50),
      entry(at(2026, 5, 31, 23, 59)),
      entry(at(2026, 5, 26, 0, 1)),
      entry(at(2026, 5, 25, 23, 59)), // 7 days ago: outside
      entry(at(2026, 6, 2, 1)), // future: outside
    ]
    const days = S.lastSevenDays(log, NOW)
    expect(days.map((d) => d.minutes)).toEqual([25, 0, 0, 0, 0, 25, 75])
    expect(days[6].sessions).toBe(2)
    expect(S.weekTotal(days)).toBe(125)
  })
  it('is correct across a DST change and month/year boundaries', () => {
    const now = at(2026, 3, 9, 12) // US DST began 2026-03-08
    const days = S.lastSevenDays([entry(at(2026, 3, 8, 12))], now)
    expect(days.map((d) => S.isoDate(d.date.getTime()))).toEqual([
      '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09',
    ])
    expect(days[5].minutes).toBe(25)
    const ny = S.lastSevenDays([], at(2026, 1, 2))
    expect(S.isoDate(ny[0].date.getTime())).toBe('2025-12-27')
  })
})

describe('currentStreak', () => {
  it('is 0 with no sessions', () => expect(S.currentStreak([], NOW)).toBe(0))
  it('counts consecutive days including today', () => {
    const log = [entry(at(2026, 6, 1)), entry(at(2026, 5, 31)), entry(at(2026, 5, 31, 15)), entry(at(2026, 5, 30)), entry(at(2026, 5, 28))]
    expect(S.currentStreak(log, NOW)).toBe(3)
  })
  it('stays alive when today is empty but yesterday had a session', () => {
    expect(S.currentStreak([entry(at(2026, 5, 31)), entry(at(2026, 5, 30))], NOW)).toBe(2)
  })
  it('is broken when neither today nor yesterday has a session', () => {
    expect(S.currentStreak([entry(at(2026, 5, 30)), entry(at(2026, 5, 29))], NOW)).toBe(0)
  })
  it('can run longer than 7 days', () => {
    const log = Array.from({ length: 12 }, (_, i) => entry(at(2026, 6, 1 - i, 12)))
    expect(S.currentStreak(log, NOW)).toBe(12)
  })
})

describe('csv', () => {
  it('has header and one row per session, oldest first, with local date and time', () => {
    const csv = S.toCsv([entry(at(2026, 6, 1, 14, 5), 25, 'B'), entry(at(2026, 5, 31, 9, 30), 50, 'A')])
    expect(csv).toBe('Date,Time,Task,Minutes\r\n2026-05-31,09:30,A,50\r\n2026-06-01,14:05,B,25\r\n')
  })
  it('quotes commas, quotes and newlines; leaves empty labels empty', () => {
    expect(S.csvField('a,b')).toBe('"a,b"')
    expect(S.csvField('say "hi"')).toBe('"say ""hi"""')
    expect(S.csvField('x\ny')).toBe('"x\ny"')
    expect(S.csvField('')).toBe('')
  })
  it('neutralises spreadsheet formulas', () => {
    expect(S.csvField('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(S.csvField('@x')).toBe("'@x")
  })
  it('header only when empty', () => expect(S.toCsv([])).toBe('Date,Time,Task,Minutes\r\n'))
})

describe('misc', () => {
  it('formats minutes', () => {
    expect(S.formatMinutes(0)).toBe('0 min')
    expect(S.formatMinutes(59)).toBe('59 min')
    expect(S.formatMinutes(60)).toBe('1 h')
    expect(S.formatMinutes(125)).toBe('2 h 5 min')
  })
  it('sanitizeLog gives pre-existing entries a minutes value', () => {
    const [e] = sanitizeLog([{ id: 'a', label: 'old', finishedAt: 1 }])
    expect(e.minutes).toBe(25)
    expect(sanitizeLog([{ id: 'a', label: '', finishedAt: 1, minutes: 40 }])[0].minutes).toBe(40)
    expect(sanitizeLog([{ id: 'a', label: '', finishedAt: 1, minutes: -3 }])[0].minutes).toBe(25)
  })
})
