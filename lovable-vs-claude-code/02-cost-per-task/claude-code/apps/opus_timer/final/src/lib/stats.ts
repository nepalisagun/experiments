import { dayKey, type LogEntry } from './log'

export interface DayStat {
  key: string // YYYY-MM-DD (local)
  date: Date // local midnight
  minutes: number
  sessions: number
}

/** Local midnight of the day `offset` days from the day containing `ts` (DST-safe). */
function startOfDay(ts: number, offset = 0): Date {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset)
}

function totalsByDay(entries: LogEntry[]): Map<string, { minutes: number; sessions: number }> {
  const map = new Map<string, { minutes: number; sessions: number }>()
  for (const e of entries) {
    const k = dayKey(e.finishedAt)
    const t = map.get(k) ?? { minutes: 0, sessions: 0 }
    t.minutes += e.minutes
    t.sessions += 1
    map.set(k, t)
  }
  return map
}

/** One entry per day for the last `days` days, oldest first, ending with today. */
export function lastNDays(entries: LogEntry[], now: number, days = 7): DayStat[] {
  const totals = totalsByDay(entries)
  return Array.from({ length: days }, (_, i) => {
    const date = startOfDay(now, i - (days - 1))
    const key = dayKey(date.getTime())
    const t = totals.get(key)
    return { key, date, minutes: t?.minutes ?? 0, sessions: t?.sessions ?? 0 }
  })
}

/** Monday 00:00 (local) of the calendar week containing `now`. */
export function startOfWeek(now: number): Date {
  const day = new Date(now).getDay() // 0 = Sunday
  return startOfDay(now, -((day + 6) % 7))
}

/** Total focus minutes in the current calendar week (Monday through now). */
export function weekMinutes(entries: LogEntry[], now: number): number {
  const from = startOfWeek(now).getTime()
  return entries.filter((e) => e.finishedAt >= from && e.finishedAt <= now).reduce((s, e) => s + e.minutes, 0)
}

/**
 * Consecutive days with at least one completed focus session, counting back from today.
 * If today has none yet, the streak is still alive and counts back from yesterday.
 */
export function currentStreak(entries: LogEntry[], now: number): number {
  const days = new Set(entries.filter((e) => e.finishedAt <= now).map((e) => dayKey(e.finishedAt)))
  let offset = days.has(dayKey(now)) ? 0 : -1
  let streak = 0
  while (days.has(dayKey(startOfDay(now, offset).getTime()))) {
    streak++
    offset--
  }
  return streak
}

/** A "nice" axis maximum and tick step for a bar chart of minutes. */
export function niceScale(max: number): { top: number; step: number } {
  const steps = [15, 30, 60, 120, 180, 240, 360, 480, 720, 960, 1440]
  if (max <= 0) return { top: 60, step: 30 }
  const step = steps.find((s) => Math.ceil(max / s) <= 4) ?? Math.ceil(max / 4 / 60) * 60
  return { top: Math.ceil(max / step) * step, step }
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function csvCell(value: string | number): string {
  let s = String(value)
  // Neutralise spreadsheet formula injection from user-typed task labels.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** All sessions, oldest first, as CSV with a header row. Dates and times are local. */
export function toCsv(entries: LogEntry[]): string {
  const rows = [...entries]
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .map((e) => {
      const d = new Date(e.finishedAt)
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      return [dayKey(e.finishedAt), time, e.task, e.minutes].map(csvCell).join(',')
    })
  return ['date,time,task,minutes', ...rows].join('\r\n') + '\r\n'
}
