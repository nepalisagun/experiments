// All money is stored and summed as integer cents, so there is no floating-point drift.

export type ParseResult = { ok: true; cents: number } | { ok: false; error: string }

const MAX_CENTS = 100_000_000_000 // 1 billion

/** Parse user input like "12", "12.5", "1,234.56" into integer cents without using float math. */
export function parseAmount(input: string): ParseResult {
  const raw = input.trim().replace(/[\s,]/g, '')
  if (raw === '') return { ok: false, error: 'Amount is required.' }
  if (raw.startsWith('-')) return { ok: false, error: 'Amount must be greater than zero.' }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(raw)
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return { ok: false, error: 'Amount must be a number, e.g. 12.50.' }
  const whole = m[1] || '0'
  const frac = m[2] ?? ''
  if (frac.length > 2) return { ok: false, error: 'Amount can have at most 2 decimal places.' }
  if (whole.replace(/^0+/, '').length > 10) return { ok: false, error: 'Amount is too large.' }
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  if (cents <= 0) return { ok: false, error: 'Amount must be greater than zero.' }
  if (cents > MAX_CENTS) return { ok: false, error: 'Amount is too large.' }
  return { ok: true, cents }
}

/** "1234.5" style plain string, always two decimals (used in inputs and CSV). */
export function centsToPlain(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(cents))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Display string with thousands separators, e.g. -1,234.50 */
export function formatCents(cents: number): string {
  const plain = centsToPlain(cents)
  const neg = plain.startsWith('-')
  const [whole, frac] = (neg ? plain.slice(1) : plain).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${grouped}.${frac}`
}

export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}
