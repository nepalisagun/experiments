import { sanitizeLog, sanitizeSettings, type LogEntry, type Settings } from './timer'

const SETTINGS_KEY = 'pomodoro.settings.v1'
const LOG_KEY = 'pomodoro.log.v1'

function read(key: string): unknown {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable or full: keep working in memory */
  }
}

export const loadSettings = (): Settings => sanitizeSettings(read(SETTINGS_KEY))
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s)
/** All completed sessions ever recorded (the Today list and Stats are filtered views of this). */
export const loadHistory = (): LogEntry[] => sanitizeLog(read(LOG_KEY))
export const saveHistory = (l: LogEntry[]) => write(LOG_KEY, l)
