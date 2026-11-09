/** Money is stored as integer cents. Parsing is string-based so no float ever touches an amount. */

/** Parse "12", "12.5", "12,50", "1,234.56" into cents. Returns null when invalid. */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/\s/g, '')
  if (!s) return null
  // If both separators appear, the last one is the decimal separator.
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma)
    const thousands = dec === lastDot ? ',' : '.'
    s = s.split(thousands).join('')
    s = s.replace(',', '.')
  } else if (lastComma >= 0) {
    // A single comma followed by 1-2 digits is a decimal comma; otherwise thousands.
    s = /^\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.split(',').join('')
  }
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0)
  return Number.isSafeInteger(cents) ? cents : null
}

/** Cents -> "1,234.50" (no currency symbol). */
export function formatCents(cents: number): string {
  const neg = cents < 0
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = String(abs % 100).padStart(2, '0')
  return (neg ? '-' : '') + whole + '.' + frac
}

/** Cents -> plain "1234.50" for CSV / editing. */
export function centsToPlain(cents: number): string {
  return formatCents(cents).replace(/,/g, '')
}
