// Pure stats over the session history. All day boundaries are local calendar days,
// stepped with Date arithmetic (not 24h multiples) so daylight-saving changes don't shift them.
import { dayKey, type LogEntry } from './timer'

export interface DayBucket {
  key: string
  /** Local midnight of the day. */
  start: number
  minutes: number
  sessions: number
}

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function addDays(ms: number, n: number): number {
  const d = new Date(startOfDay(ms))
  d.setDate(d.getDate() + n)
  return d.getTime()
}

/** Minutes and sessions per day for the last `days` days, oldest first, ending today. */
export function lastDays(log: LogEntry[], now: number, days = 7): DayBucket[] {
  const buckets = Array.from({ length: days }, (_, i) => {
    const start = addDays(now, i - (days - 1))
    return { key: dayKey(start), start, minutes: 0, sessions: 0 }
  })
  const byKey = new Map(buckets.map((b) => [b.key, b]))
  for (const e of log) {
    const b = byKey.get(dayKey(e.finishedAt))
    if (b) {
      b.minutes += e.minutes
      b.sessions += 1
    }
  }
  return buckets
}

/** Local midnight of the Monday that starts the current week. */
export function startOfWeek(now: number): number {
  const dow = new Date(now).getDay() // 0 = Sunday
  return addDays(now, -((dow + 6) % 7))
}

/** Focus minutes in the current calendar week (Monday through now). */
export function weekMinutes(log: LogEntry[], now: number): number {
  const from = startOfWeek(now)
  return log.reduce((sum, e) => (e.finishedAt >= from && e.finishedAt <= now ? sum + e.minutes : sum), 0)
}

/**
 * Consecutive days with at least one completed focus session, counting back from today.
 * A day with nothing yet today doesn't break the streak: it then counts back from yesterday.
 */
export function streak(log: LogEntry[], now: number): number {
  const days = new Set(log.map((e) => dayKey(e.finishedAt)))
  let day = days.has(dayKey(now)) ? startOfDay(now) : addDays(now, -1)
  let n = 0
  while (days.has(dayKey(day))) {
    n++
    day = addDays(day, -1)
  }
  return n
}

const pad = (n: number) => String(n).padStart(2, '0')

function csvField(value: string): string {
  // Spreadsheet apps execute cells starting with these characters as formulas.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** All sessions, oldest first: date (YYYY-MM-DD), time (HH:MM, 24h local), task label, minutes. */
export function toCsv(log: LogEntry[]): string {
  const rows = [...log]
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .map((e) => {
      const d = new Date(e.finishedAt)
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
      return [date, time, csvField(e.task), String(e.minutes)].join(',')
    })
  return ['date,time,task,minutes', ...rows].join('\r\n') + '\r\n'
}

export function csvFilename(now: number): string {
  const d = new Date(now)
  return `pomodoro-sessions-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`
}
