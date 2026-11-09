// All amounts are stored as integer cents, so arithmetic is exact (0.10 + 0.20 === 0.30).

export const MAX_CENTS = 100_000_000_000 // 1 billion in major units

export type ParseResult = { ok: true; cents: number } | { ok: false; error: string }

/** Parse a user-typed amount like "12", "12.5", "12,50" or "1 234.56" into integer cents. */
export function parseAmount(input: string): ParseResult {
  const s = input.trim().replace(/[\s_]/g, '')
  if (s === '') return { ok: false, error: 'Enter an amount.' }
  // "1,234.56" -> thousands separators; "12,50" -> decimal comma.
  const normalised = s.includes('.') ? s.replace(/,(?=\d{3}(\D|$))/g, '') : s.replace(',', '.')
  if (normalised.startsWith('-')) return { ok: false, error: 'Amount must be above zero.' }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(normalised)
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return { ok: false, error: 'Amount must be a number, e.g. 12.50.' }
  const frac = m[2] ?? ''
  if (frac.length > 2) return { ok: false, error: 'Use at most 2 decimal places.' }
  const whole = m[1] === '' ? 0 : Number(m[1])
  const cents = whole * 100 + Number(frac.padEnd(2, '0'))
  if (cents <= 0) return { ok: false, error: 'Amount must be above zero.' }
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return { ok: false, error: 'Amount is too large.' }
  return { ok: true, cents }
}

/** Format integer cents as "1,234.56" (no currency symbol). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}${whole.toLocaleString('en-US')}.${frac}`
}

/** Plain machine format for CSV and form inputs: "1234.56". */
export function centsToPlain(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
