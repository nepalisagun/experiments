import { dayKey } from './timer'
import type { LogEntry } from './timer'

export interface DayStat { key: string; date: Date; minutes: number; sessions: number; isToday: boolean }

/** Local calendar day `back` days before `now` (DST-safe: builds the date from y/m/d). */
export function daysAgo(now: number, back: number): Date {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back)
}

/** Focus minutes per local day for the 7 days ending today, oldest first. */
export function lastSevenDays(log: LogEntry[], now: number): DayStat[] {
  const byDay = new Map<string, { minutes: number; sessions: number }>()
  for (const e of log) {
    const k = dayKey(e.finishedAt)
    const cur = byDay.get(k) ?? { minutes: 0, sessions: 0 }
    cur.minutes += e.minutes
    cur.sessions += 1
    byDay.set(k, cur)
  }
  const todayKey = dayKey(now)
  return Array.from({ length: 7 }, (_, i) => {
    const date = daysAgo(now, 6 - i)
    const key = dayKey(date.getTime())
    const v = byDay.get(key)
    return { key, date, minutes: v?.minutes ?? 0, sessions: v?.sessions ?? 0, isToday: key === todayKey }
  })
}

export const weekTotal = (days: DayStat[]) => days.reduce((n, d) => n + d.minutes, 0)

/**
 * Consecutive days with at least one completed focus session, ending today.
 * If nothing is done yet today, the streak is still alive and counts back from yesterday.
 */
export function currentStreak(log: LogEntry[], now: number): number {
  const days = new Set(log.map((e) => dayKey(e.finishedAt)))
  let back = days.has(dayKey(now)) ? 0 : 1
  let streak = 0
  while (days.has(dayKey(daysAgo(now, back).getTime()))) {
    streak++
    back++
  }
  return streak
}

export function formatMinutes(min: number) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const isoTime = (ts: number) => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Quote for CSV, and defuse spreadsheet formulas (=, +, -, @) in user-typed labels. */
export function csvField(value: string): string {
  let v = value
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** All sessions, oldest first. */
export function toCsv(log: LogEntry[]): string {
  const rows = [...log]
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .map((e) => [isoDate(e.finishedAt), isoTime(e.finishedAt), csvField(e.label), String(e.minutes)].join(','))
  return ['Date,Time,Task,Minutes', ...rows].join('\r\n') + '\r\n'
}
