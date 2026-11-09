export interface LogEntry {
  id: string
  task: string
  finishedAt: number
  minutes: number
}

export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Entries finished on the same local day as `now`, newest first. */
export function todaysEntries(entries: LogEntry[], now: number): LogEntry[] {
  const today = dayKey(now)
  return entries.filter((e) => dayKey(e.finishedAt) === today).sort((a, b) => b.finishedAt - a.finishedAt)
}

/** Append a completed session to the full history (kept oldest first). */
export function addEntry(entries: LogEntry[], entry: Omit<LogEntry, 'id'>): LogEntry[] {
  const id = `${entry.finishedAt}-${Math.random().toString(36).slice(2, 8)}`
  return [...entries, { ...entry, id }].sort((a, b) => a.finishedAt - b.finishedAt)
}

/** Validate stored history: drop malformed entries, keep every day. */
export function sanitizeHistory(value: unknown): LogEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (e): e is LogEntry =>
        !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.task === 'string' &&
        Number.isFinite(e.finishedAt) && Number.isFinite(e.minutes) && e.minutes > 0,
    )
    .sort((a, b) => a.finishedAt - b.finishedAt)
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
