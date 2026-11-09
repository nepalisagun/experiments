import { useEffect, useMemo, useRef, useState } from 'react'
import { Breakdown } from './components/Breakdown'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Items } from './components/Items'
import { People } from './components/People'
import { Payments } from './components/Payments'
import { SettleUp } from './components/SettleUp'
import { TaxTip } from './components/TaxTip'
import { checkPayments, computeSettlement } from './lib/settle'
import { buildSummary } from './lib/summary'
import {
  computeBreakdown,
  CURRENCIES,
  deserializeBill,
  emptyBill,
  itemsOnlySharedBy,
  removePerson,
  STORAGE_KEY,
  type Bill,
  type Currency,
} from './lib/bill'

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

function loadBill(): Bill {
  try {
    return deserializeBill(localStorage.getItem(STORAGE_KEY))
  } catch {
    return emptyBill()
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

type Confirm = { kind: 'reset' } | { kind: 'remove-person'; id: string } | null

export default function App() {
  const [bill, setBill] = useState<Bill>(loadBill)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [status, setStatus] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)
  const statusTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bill))
    } catch {
      /* storage full or unavailable: the app still works for this session */
    }
  }, [bill])

  const breakdown = useMemo(() => computeBreakdown(bill), [bill])
  const paymentCheck = useMemo(() => checkPayments(bill, breakdown.total), [bill, breakdown])
  const settlement = useMemo(() => computeSettlement(bill, breakdown), [bill, breakdown])
  const update = (patch: Partial<Bill>) => setBill((b) => ({ ...b, ...patch }))

  const flash = (text: string, tone: 'ok' | 'err') => {
    setStatus({ text, tone })
    window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setStatus(null), 2500)
  }

  const copySummary = async () => {
    const ok = await copyText(buildSummary(bill, breakdown))
    flash(ok ? 'Summary copied to clipboard' : 'Could not copy. Your browser blocked clipboard access.', ok ? 'ok' : 'err')
  }

  const requestRemovePerson = (id: string) => {
    const isPayer = bill.payments.some((p) => p.personId === id)
    if (itemsOnlySharedBy(bill, id).length > 0 || isPayer) setConfirm({ kind: 'remove-person', id })
    else setBill((b) => removePerson(b, id))
  }

  const pendingPerson = confirm?.kind === 'remove-person' ? bill.people.find((p) => p.id === confirm.id) : undefined
  const orphaned = confirm?.kind === 'remove-person' ? itemsOnlySharedBy(bill, confirm.id) : []
  const pendingPaid = confirm?.kind === 'remove-person' && bill.payments.some((p) => p.personId === confirm.id)

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
          <h1 className="mr-auto text-xl font-bold tracking-tight">
            Split<span className="text-emerald-700">the</span>Bill
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="currency" className="sr-only">
              Currency
            </label>
            <select
              id="currency"
              className="input w-auto py-2"
              value={bill.currency}
              onChange={(e) => update({ currency: e.target.value as Currency })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="button" className="btn-primary" onClick={copySummary}>
              Copy summary
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirm({ kind: 'reset' })}>
              Reset
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:py-6">
        <div className="space-y-4">
          <People
            people={bill.people}
            onAdd={(name) => setBill((b) => ({ ...b, people: [...b.people, { id: newId(), name }] }))}
            onRename={(id, name) => setBill((b) => ({ ...b, people: b.people.map((p) => (p.id === id ? { ...p, name } : p)) }))}
            onRemove={requestRemovePerson}
          />
          <Items
            items={bill.items}
            people={bill.people}
            currency={bill.currency}
            onAdd={(it) => setBill((b) => ({ ...b, items: [...b.items, { ...it, id: newId() }] }))}
            onUpdate={(id, it) => setBill((b) => ({ ...b, items: b.items.map((x) => (x.id === id ? { ...it, id } : x)) }))}
            onRemove={(id) => setBill((b) => ({ ...b, items: b.items.filter((x) => x.id !== id) }))}
          />
        </div>
        <div className="space-y-4">
          <TaxTip
            taxPct={bill.taxPct}
            tipMode={bill.tipMode}
            customTipPct={bill.customTipPct}
            onTax={(taxPct) => update({ taxPct })}
            onTipMode={(tipMode) => update({ tipMode })}
            onCustomTip={(customTipPct) => update({ customTipPct })}
          />
          <Breakdown breakdown={breakdown} currency={bill.currency} />
          <Payments
            payments={bill.payments}
            people={bill.people}
            currency={bill.currency}
            totalCents={breakdown.total}
            check={paymentCheck}
            onAdd={(personId, amount) => setBill((b) => ({ ...b, payments: [...b.payments, { id: newId(), personId, amount }] }))}
            onChange={(id, patch) => setBill((b) => ({ ...b, payments: b.payments.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))}
            onRemove={(id) => setBill((b) => ({ ...b, payments: b.payments.filter((p) => p.id !== id) }))}
          />
          <SettleUp settlement={settlement} people={bill.people} currency={bill.currency} />
        </div>
      </main>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 flex justify-center px-4">
        {status && (
          <div
            role="status"
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${status.tone === 'ok' ? 'bg-stone-900' : 'bg-red-600'}`}
          >
            {status.text}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'reset'}
        title="Reset the bill?"
        message="This removes all people, items, payments, tax and tip. It can't be undone."
        confirmLabel="Reset"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setBill((b) => ({ ...emptyBill(), currency: b.currency }))
          setConfirm(null)
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'remove-person'}
        title={`Remove ${pendingPerson?.name ?? 'person'}?`}
        message={
          <>
            {orphaned.length > 0 && (
              <p>
                {pendingPerson?.name} is the only person on {orphaned.length === 1 ? 'this item' : 'these items'}, so{' '}
                {orphaned.length === 1 ? 'it' : 'they'} will be removed too:{' '}
                <strong className="text-stone-800">{orphaned.map((i) => i.name).join(', ')}</strong>
              </p>
            )}
            {pendingPaid && (
              <p className={orphaned.length > 0 ? 'mt-2' : ''}>
                Their payment will be removed too, so the payments may no longer add up to the bill total.
              </p>
            )}
          </>
        }
        confirmLabel="Remove"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'remove-person') setBill((b) => removePerson(b, confirm.id))
          setConfirm(null)
        }}
      />
    </div>
  )
}
