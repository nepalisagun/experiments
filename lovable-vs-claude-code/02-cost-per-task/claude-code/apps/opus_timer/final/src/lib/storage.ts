export const KEYS = {
  settings: 'pomodoro.settings',
  log: 'pomodoro.log',
  timer: 'pomodoro.timer',
  muted: 'pomodoro.muted',
  task: 'pomodoro.task',
} as const

export function load(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the app keeps working in memory.
  }
}
