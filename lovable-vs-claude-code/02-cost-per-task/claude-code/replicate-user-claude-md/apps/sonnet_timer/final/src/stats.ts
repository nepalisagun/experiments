import { dayKey, type LogEntry } from './timer'

export interface DayStat {
  key: string
  /** local midnight of that day */
  date: Date
  minutes: number
  sessions: number
}

/** Local calendar day `back` days before `now` (0 = today). Uses date arithmetic so DST can't skip or repeat a day. */
export function daysAgo(now: number, back: number): Date {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back)
}

/** The last `n` local days, oldest first, ending with today. */
export function lastDays(history: LogEntry[], now: number, n = 7): DayStat[] {
  const byDay = new Map<string, { minutes: number; sessions: number }>()
  for (const e of history) {
    const k = dayKey(e.finishedAt)
    const cur = byDay.get(k) ?? { minutes: 0, sessions: 0 }
    cur.minutes += e.minutes
    cur.sessions += 1
    byDay.set(k, cur)
  }
  const out: DayStat[] = []
  for (let i = n - 1; i >= 0; i--) {
    const date = daysAgo(now, i)
    const key = dayKey(date.getTime())
    const v = byDay.get(key)
    out.push({ key, date, minutes: v?.minutes ?? 0, sessions: v?.sessions ?? 0 })
  }
  return out
}

export function totalMinutes(days: DayStat[]): number {
  return days.reduce((sum, d) => sum + d.minutes, 0)
}

/**
 * Consecutive days with at least one completed focus session, ending today.
 * If today has none yet, the streak is still alive and counts back from yesterday.
 */
export function currentStreak(history: LogEntry[], now: number): number {
  const active = new Set(history.map((e) => dayKey(e.finishedAt)))
  let back = active.has(dayKey(now)) ? 0 : 1
  let streak = 0
  while (active.has(dayKey(daysAgo(now, back).getTime()))) {
    streak++
    back++
  }
  return streak
}

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (ts: number) => {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
const isoTime = (ts: number) => {
  const d = new Date(ts)
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** RFC 4180 quoting, plus a leading apostrophe on values a spreadsheet would run as a formula. */
export function csvField(value: string): string {
  let v = value
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}

export function toCsv(history: LogEntry[]): string {
  const rows = [...history]
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .map((e) => [isoDate(e.finishedAt), isoTime(e.finishedAt), csvField(e.task), String(e.minutes)].join(','))
  return ['date,time,task,minutes', ...rows].join('\r\n') + '\r\n'
}
