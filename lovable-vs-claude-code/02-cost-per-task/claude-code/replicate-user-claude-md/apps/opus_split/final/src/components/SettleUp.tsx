import { formatMoney, type Currency, type Person } from '../lib/bill'
import type { Settlement } from '../lib/settle'

export function SettleUp({ settlement, people, currency }: { settlement: Settlement; people: Person[]; currency: Currency }) {
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? '?'

  return (
    <section className="card" aria-labelledby="settle-title">
      <h2 id="settle-title" className="card-title">
        Settle up
      </h2>
      {settlement.status === 'no-payers' && (
        <p className="text-sm text-stone-500">Record who paid to see who owes whom.</p>
      )}
      {settlement.status === 'invalid' && (
        <p className="text-sm text-stone-500">Transfers will appear once the payments add up to the bill total.</p>
      )}
      {settlement.status === 'ok' &&
        (settlement.transfers.length === 0 ? (
          <p className="text-sm text-emerald-700">Everyone is even. No transfers needed.</p>
        ) : (
          <ol className="space-y-2" aria-label="Transfers">
            {settlement.transfers.map((t, i) => (
              <li
                key={`${t.from}-${t.to}-${i}`}
                data-testid="transfer"
                className="rounded-lg bg-stone-50 px-3 py-2 break-words"
              >
                <strong className="font-semibold">{name(t.from)}</strong> pays <strong className="font-semibold">{name(t.to)}</strong>{' '}
                <span className="font-semibold whitespace-nowrap text-emerald-800 tabular-nums">{formatMoney(t.cents, currency)}</span>
              </li>
            ))}
          </ol>
        ))}
      {settlement.status === 'ok' && settlement.transfers.length > 0 && (
        <p className="mt-3 text-xs text-stone-500">
          {settlement.transfers.length === 1 ? 'One transfer' : `${settlement.transfers.length} transfers`}, the fewest needed to even everyone out.
        </p>
      )}
    </section>
  )
}
