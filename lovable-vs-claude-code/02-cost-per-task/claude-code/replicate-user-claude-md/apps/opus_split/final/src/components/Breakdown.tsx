import { formatMoney, formatPercent, type Breakdown as B, type Currency } from '../lib/bill'

export function Breakdown({ breakdown: b, currency }: { breakdown: B; currency: Currency }) {
  const m = (c: number) => formatMoney(c, currency)

  return (
    <section className="card" aria-labelledby="breakdown-title">
      <h2 id="breakdown-title" className="card-title">
        Per person
      </h2>

      {b.shares.length === 0 ? (
        <p className="text-sm text-stone-500">Add people and items to see who owes what.</p>
      ) : (
        <ul className="space-y-3" aria-label="Per-person breakdown">
          {b.shares.map((s) => (
            <li key={s.personId} className="rounded-lg border border-stone-200 p-3" data-testid="share">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold" data-testid="share-name">
                  {s.name}
                </span>
                <span className="shrink-0 text-lg font-semibold tabular-nums" data-testid="share-total">
                  {m(s.total)}
                </span>
              </div>
              <dl className="mt-1 grid grid-cols-3 gap-2 text-sm text-stone-600">
                <div>
                  <dt className="text-xs text-stone-500">Items</dt>
                  <dd className="tabular-nums" data-testid="share-subtotal">{m(s.subtotal)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Tax</dt>
                  <dd className="tabular-nums" data-testid="share-tax">{m(s.tax)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">Tip</dt>
                  <dd className="tabular-nums" data-testid="share-tip">{m(s.tip)}</dd>
                </div>
              </dl>
              {s.items.length > 0 && (
                <p className="mt-1 truncate text-xs text-stone-500" title={s.items.map((i) => i.name).join(', ')}>
                  {s.items.map((i) => (i.sharedWith > 1 ? `${i.name} (1/${i.sharedWith})` : i.name)).join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-4 space-y-1 border-t border-stone-200 pt-3 text-sm" aria-label="Bill totals">
        <Row label="Subtotal" value={m(b.subtotal)} testId="bill-subtotal" />
        <Row label={`Tax (${formatPercent(b.taxPctScaled)})`} value={m(b.tax)} testId="bill-tax" />
        <Row label={`Tip (${formatPercent(b.tipPctScaled)})`} value={m(b.tip)} testId="bill-tip" />
        <div className="flex justify-between pt-1 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums" data-testid="bill-total">
            {m(b.total)}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function Row({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex justify-between text-stone-600">
      <dt>{label}</dt>
      <dd className="tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  )
}
