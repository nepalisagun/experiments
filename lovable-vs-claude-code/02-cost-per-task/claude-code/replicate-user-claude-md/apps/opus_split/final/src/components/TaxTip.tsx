import { parsePercent, TIP_PRESETS, type TipMode } from '../lib/bill'

interface Props {
  taxPct: string
  tipMode: TipMode
  customTipPct: string
  onTax: (v: string) => void
  onTipMode: (m: TipMode) => void
  onCustomTip: (v: string) => void
}

export function TaxTip({ taxPct, tipMode, customTipPct, onTax, onTipMode, onCustomTip }: Props) {
  const tax = parsePercent(taxPct, 'Tax')
  const tip = parsePercent(customTipPct, 'Tip')
  const taxErr = tax.ok ? null : tax.error
  const tipErr = tipMode === 'custom' && !tip.ok ? tip.error : null

  return (
    <section className="card" aria-labelledby="taxtip-title">
      <h2 id="taxtip-title" className="card-title">
        Tax &amp; tip
      </h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="tax" className="mb-1 block text-sm font-medium text-stone-700">
            Tax
          </label>
          <div className="relative w-36">
            <input
              id="tax"
              className="input pr-8 tabular-nums"
              inputMode="decimal"
              value={taxPct}
              aria-invalid={!!taxErr}
              aria-describedby={taxErr ? 'tax-error' : undefined}
              onChange={(e) => onTax(e.target.value)}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-stone-500">%</span>
          </div>
          {taxErr && (
            <p id="tax-error" role="alert" className="error-text">
              {taxErr} Tax is counted as 0% until fixed.
            </p>
          )}
        </div>

        <div>
          <span id="tip-label" className="mb-1 block text-sm font-medium text-stone-700">
            Tip
          </span>
          <div role="group" aria-labelledby="tip-label" className="flex flex-wrap gap-2">
            {TIP_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={tipMode === p}
                className={tipMode === p ? 'btn-primary' : 'btn-secondary'}
                onClick={() => onTipMode(p)}
              >
                {p}%
              </button>
            ))}
            <button
              type="button"
              aria-pressed={tipMode === 'custom'}
              className={tipMode === 'custom' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => {
                onTipMode('custom')
                requestAnimationFrame(() => document.getElementById('custom-tip')?.focus())
              }}
            >
              Custom
            </button>
          </div>
          {tipMode === 'custom' && (
            <div className="mt-2">
              <label htmlFor="custom-tip" className="sr-only">
                Custom tip percentage
              </label>
              <div className="relative w-36">
                <input
                  id="custom-tip"
                  className="input pr-8 tabular-nums"
                  inputMode="decimal"
                  placeholder="e.g. 18"
                  value={customTipPct}
                  aria-invalid={!!tipErr}
                  aria-describedby={tipErr ? 'tip-error' : undefined}
                  onChange={(e) => onCustomTip(e.target.value)}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-stone-500">%</span>
              </div>
              {tipErr && (
                <p id="tip-error" role="alert" className="error-text">
                  {tipErr} Tip is counted as 0% until fixed.
                </p>
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-stone-500">Tax and tip are calculated on the items subtotal and split in proportion to what each person had.</p>
        </div>
      </div>
    </section>
  )
}
