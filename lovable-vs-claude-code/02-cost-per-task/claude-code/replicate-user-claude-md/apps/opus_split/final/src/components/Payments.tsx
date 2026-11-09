import { formatMoney, parsePrice, type Currency, type Payment, type Person } from '../lib/bill'
import type { PaymentCheck } from '../lib/settle'

interface Props {
  payments: Payment[]
  people: Person[]
  currency: Currency
  totalCents: number
  check: PaymentCheck
  onAdd: (personId: string, amount: string) => void
  onChange: (id: string, patch: Partial<Omit<Payment, 'id'>>) => void
  onRemove: (id: string) => void
}

const toInput = (cents: number) => (cents / 100).toFixed(2)

export function Payments({ payments, people, currency, totalCents, check, onAdd, onChange, onRemove }: Props) {
  const m = (c: number) => formatMoney(c, currency)
  const used = new Set(payments.map((p) => p.personId))
  const unused = people.filter((p) => !used.has(p.id))
  const allValid = check.rowErrors.every((e) => !e)
  const remaining = Math.max(0, totalCents - check.paidCents)

  // Offer a one-click fix for a mismatch by adjusting the last payer.
  const last = payments[payments.length - 1]
  const lastCents = last ? parsePrice(last.amount) : undefined
  const fixed = lastCents?.ok ? lastCents.value - check.difference : -1
  const lastName = last && people.find((p) => p.id === last.personId)?.name

  return (
    <section className="card" aria-labelledby="payments-title">
      <h2 id="payments-title" className="card-title">
        Who paid
      </h2>

      {people.length === 0 ? (
        <p className="text-sm text-stone-500">Add people first.</p>
      ) : (
        <>
          {payments.length === 0 && <p className="mb-3 text-sm text-stone-500">Record who paid the restaurant and how much.</p>}
          <ul className="space-y-3" aria-label="Payers">
            {payments.map((p, i) => {
              const err = check.rowErrors[i]
              const errId = `payment-error-${p.id}`
              const name = people.find((x) => x.id === p.personId)?.name ?? 'payer'
              return (
                <li key={p.id} data-testid="payment-row">
                  <div className="flex gap-2">
                    <label className="sr-only" htmlFor={`payer-${p.id}`}>
                      Payer {i + 1}
                    </label>
                    <select
                      id={`payer-${p.id}`}
                      className="input min-w-0 flex-1"
                      value={p.personId}
                      onChange={(e) => onChange(p.id, { personId: e.target.value })}
                    >
                      {!people.some((x) => x.id === p.personId) && <option value="">Choose…</option>}
                      {people
                        .filter((x) => x.id === p.personId || !used.has(x.id))
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                    <label className="sr-only" htmlFor={`amount-${p.id}`}>
                      Amount paid by {name}
                    </label>
                    <input
                      id={`amount-${p.id}`}
                      className="input w-28 shrink-0 tabular-nums"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={p.amount}
                      aria-invalid={!!err}
                      aria-describedby={err ? errId : undefined}
                      onChange={(e) => onChange(p.id, { amount: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn-ghost shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                      aria-label={`Remove payment by ${name}`}
                      onClick={() => onRemove(p.id)}
                    >
                      ✕
                    </button>
                  </div>
                  {err && (
                    <p id={errId} role="alert" className="error-text">
                      {err}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>

          <button
            type="button"
            className="btn-secondary mt-3"
            disabled={unused.length === 0}
            onClick={() => onAdd(unused[0].id, allValid && remaining > 0 ? toInput(remaining) : '')}
          >
            + Add payer
          </button>

          {payments.length > 0 && allValid && (
            <div className="mt-3 text-sm" data-testid="payments-status">
              {check.sumError ? (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                  <p>{check.sumError}</p>
                  {last && fixed >= 0 && (
                    <button
                      type="button"
                      className="mt-2 font-medium text-red-800 underline underline-offset-2 hover:no-underline"
                      onClick={() => onChange(last.id, { amount: toInput(fixed) })}
                    >
                      Set {lastName}'s payment to {m(fixed)}
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-emerald-700">✓ Payments add up to the bill total of {m(totalCents)}.</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
