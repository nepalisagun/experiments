import { test, expect } from '@playwright/test'
import { csvField, currentStreak, lastDays, toCsv, totalMinutes } from '../src/stats'
import { sanitizeLog, type LogEntry } from '../src/timer'

// Mon 9 Nov 2026, 15:00 local
const NOW = new Date(2026, 10, 9, 15, 0).getTime()
const at = (dayOfNov: number, h = 10, m = 0) => new Date(2026, 10, dayOfNov, h, m).getTime()
let n = 0
const entry = (finishedAt: number, minutes = 25, task = ''): LogEntry => ({ id: 'e' + n++, task, finishedAt, minutes })

test('lastDays returns 7 days oldest first, ending today, summing minutes per day', () => {
  const h = [entry(at(9, 9), 25), entry(at(9, 11), 30), entry(at(8), 25), entry(at(3), 50), entry(at(2), 99)]
  const d = lastDays(h, NOW, 7)
  expect(d).toHaveLength(7)
  expect(d.map((x) => x.date.getDate())).toEqual([3, 4, 5, 6, 7, 8, 9])
  expect(d.map((x) => x.minutes)).toEqual([50, 0, 0, 0, 0, 25, 55])
  expect(d[6].sessions).toBe(2)
  expect(totalMinutes(d)).toBe(130) // Nov 2 is outside the window
})

test('lastDays handles a month boundary and midnight edges', () => {
  const now = new Date(2026, 11, 2, 0, 5).getTime() // 2 Dec, just after midnight
  const h = [entry(new Date(2026, 10, 30, 23, 59).getTime(), 25), entry(new Date(2026, 11, 2, 0, 1).getTime(), 10)]
  const d = lastDays(h, now, 7)
  expect(d.map((x) => x.date.getDate())).toEqual([26, 27, 28, 29, 30, 1, 2])
  expect(d[4].minutes).toBe(25)
  expect(d[6].minutes).toBe(10)
})

test('lastDays does not skip or repeat a day across a DST change', () => {
  // 2026-10-25 is the EU fall-back date and 2026-03-08 the US spring-forward date; whichever the machine
  // uses, 7 consecutive calendar days must come out distinct.
  for (const now of [new Date(2026, 9, 27, 12).getTime(), new Date(2026, 2, 10, 12).getTime()]) {
    const keys = lastDays([], now, 7).map((x) => x.key)
    expect(new Set(keys).size).toBe(7)
  }
})

test('streak counts consecutive days ending today', () => {
  const h = [entry(at(9)), entry(at(8)), entry(at(7)), entry(at(5))]
  expect(currentStreak(h, NOW)).toBe(3) // gap on the 6th ends it
})

test('streak stays alive when today has no session yet (counts from yesterday)', () => {
  expect(currentStreak([entry(at(8)), entry(at(7))], NOW)).toBe(2)
})

test('streak is 0 when neither today nor yesterday has a session, or history is empty', () => {
  expect(currentStreak([entry(at(7)), entry(at(6))], NOW)).toBe(0)
  expect(currentStreak([], NOW)).toBe(0)
})

test('several sessions on one day count once; a long run crosses a month boundary', () => {
  const h = [entry(at(9, 8)), entry(at(9, 9)), entry(at(9, 10))]
  expect(currentStreak(h, NOW)).toBe(1)
  const run: LogEntry[] = []
  for (let i = 0; i < 12; i++) run.push(entry(new Date(2026, 10, 9 - i, 12).getTime()))
  expect(currentStreak(run, NOW)).toBe(12) // Nov 9 back through Oct 29, across the month boundary
  const gap = run.filter((_, i) => i !== 9) // drop Oct 31
  expect(currentStreak(gap, NOW)).toBe(9) // Nov 9..1
})

test('csvField quotes commas, quotes, newlines and defuses formulas', () => {
  expect(csvField('plain')).toBe('plain')
  expect(csvField('a, b')).toBe('"a, b"')
  expect(csvField('say "hi"')).toBe('"say ""hi"""')
  expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  expect(csvField('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
  expect(csvField('-1+1')).toBe("'-1+1")
  expect(csvField('')).toBe('')
})

test('toCsv: header, chronological order, local date/time, minutes', () => {
  const h = [entry(at(9, 14, 5), 25, 'Later, "quoted"'), entry(at(8, 9, 30), 50, 'Earlier'), entry(at(8, 18, 0), 15, '')]
  expect(toCsv(h)).toBe(
    ['date,time,task,minutes', '2026-11-08,09:30,Earlier,50', '2026-11-08,18:00,,15', '2026-11-09,14:05,"Later, ""quoted""",25', ''].join('\r\n'),
  )
  expect(toCsv([])).toBe('date,time,task,minutes\r\n')
})

test('sanitizeLog keeps old entries without minutes (default 25) and drops bad ones', () => {
  const out = sanitizeLog([
    { id: 'a', task: 't', finishedAt: 5 },
    { id: 'b', task: 't', finishedAt: 6, minutes: 40 },
    { id: 'c', task: 't', finishedAt: 7, minutes: -3 },
    { id: 'd', task: 't', finishedAt: NaN },
    { id: 'e', task: 5, finishedAt: 1 },
  ])
  expect(out.map((e) => [e.id, e.minutes])).toEqual([
    ['a', 25],
    ['b', 40],
    ['c', 25],
  ])
})
