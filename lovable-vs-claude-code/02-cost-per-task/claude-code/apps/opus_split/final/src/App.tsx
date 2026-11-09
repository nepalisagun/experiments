import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CURRENCIES,
  STORAGE_KEY,
  TIP_PRESETS,
  buildSummary,
  computeTotals,
  deserializeBill,
  effectiveTipText,
  emptyBill,
  formatMoney,
  itemsOnlySharedBy,
  parsePercent,
  settleUp,
  balances,
  transferText,
  validateItem,
  validatePayments,
  validatePersonName,
  type Bill,
  type PaymentsCheck,
  type Currency,
  type ItemDraft,
  type ItemErrors,
} from './lib/bill'

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

function loadBill(): Bill {
  try {
    return deserializeBill(localStorage.getItem(STORAGE_KEY))
  } catch {
    return emptyBill()
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

const card = 'rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4 sm:p-5'
const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-100'
const btn =
  'inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50'
const btnPrimary = `${btn} bg-emerald-600 text-white hover:bg-emerald-700`
const btnGhost = `${btn} text-slate-700 hover:bg-slate-100 ring-1 ring-slate-300`
const btnDanger = `${btn} text-red-700 hover:bg-red-50 ring-1 ring-red-200`

function FieldError({ id, msg }: { id: string; msg?: string | null }) {
  if (!msg) return null
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-red-600">
      {msg}
    </p>
  )
}

export default function App() {
  const [bill, setBill] = useState<Bill>(loadBill)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bill))
    } catch {
      /* storage full or blocked: app keeps working in memory */
    }
  }, [bill])

  const taxParse = parsePercent(bill.taxText, 'Tax')
  const tipParse = parsePercent(effectiveTipText(bill), 'Tip')
  const taxPct = taxParse.ok ? taxParse.value : 0
  const tipPct = tipParse.ok ? tipParse.value : 0
  const totals = useMemo(() => computeTotals(bill.people, bill.items, taxPct, tipPct), [bill.people, bill.items, taxPct, tipPct])
  const money = (c: number) => formatMoney(c, bill.currency)
  const payCheck = validatePayments(bill.payments, bill.people, totals.total, bill.currency)

  const update = (patch: Partial<Bill>) => setBill((b) => ({ ...b, ...patch }))

  // ---- copy / reset ----
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const onCopy = async () => {
    const ok = await copyText(buildSummary(bill, totals, taxPct, tipPct))
    setCopyStatus(ok ? 'Summary copied to clipboard.' : 'Could not copy — your browser blocked clipboard access.')
    window.setTimeout(() => setCopyStatus(null), 2500)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-xl font-bold tracking-tight">
            <span aria-hidden>🍽️ </span>Split the Bill
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-600">Currency</span>
              <select
                aria-label="Currency"
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={bill.currency}
                onChange={(e) => update({ currency: e.target.value as Currency })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <button className={btnGhost} onClick={onCopy}>
              Copy summary
            </button>
            <button className={btnDanger} onClick={() => setConfirmReset(true)}>
              Reset
            </button>
          </div>
        </div>
        {copyStatus && (
          <p role="status" className="mx-auto max-w-6xl px-4 pb-2 text-sm text-emerald-700">
            {copyStatus}
          </p>
        )}
      </header>

      {confirmReset && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-desc" className={`${card} w-full max-w-sm`}>
            <h2 id="reset-title" className="text-lg font-semibold">
              Reset the bill?
            </h2>
            <p id="reset-desc" className="mt-1 text-sm text-slate-600">
              This removes all people, items, tax and tip. It can't be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button autoFocus className={btnGhost} onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button
                className={`${btn} bg-red-600 text-white hover:bg-red-700`}
                onClick={() => {
                  setBill({ ...emptyBill(), currency: bill.currency })
                  setConfirmReset(false)
                }}
              >
                Yes, reset
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div className="grid min-w-0 gap-4">
          <PeopleSection bill={bill} setBill={setBill} />
          <ItemsSection bill={bill} setBill={setBill} money={money} />
          <TaxTipSection bill={bill} update={update} taxError={taxParse.ok ? null : taxParse.error} tipError={tipParse.ok ? null : tipParse.error} />
          <PaymentsSection bill={bill} setBill={setBill} check={payCheck} total={totals.total} money={money} />
        </div>
        <div className="grid min-w-0 gap-4">
          <Breakdown totals={totals} money={money} taxPct={taxPct} tipPct={tipPct} />
          <SettleUpSection bill={bill} check={payCheck} totals={totals} />
        </div>
      </main>
    </div>
  )
}

// ---------------- People ----------------

function PeopleSection({ bill, setBill }: { bill: Bill; setBill: React.Dispatch<React.SetStateAction<Bill>> }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null)
  // A "can't remove" message goes stale as soon as the items or people change.
  useEffect(() => setRowError(null), [bill.items, bill.people])

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    const err = validatePersonName(name, bill.people)
    if (err) return setError(err)
    setBill((b) => ({ ...b, people: [...b.people, { id: newId(), name: name.trim() }] }))
    setName('')
    setError(null)
  }

  const saveRename = (id: string) => {
    const err = validatePersonName(editName, bill.people, id)
    if (err) return setEditError(err)
    setBill((b) => ({ ...b, people: b.people.map((p) => (p.id === id ? { ...p, name: editName.trim() } : p)) }))
    setEditingId(null)
    setEditError(null)
  }

  const remove = (id: string) => {
    const blocking = itemsOnlySharedBy(id, bill.items)
    if (blocking.length) {
      const person = bill.people.find((p) => p.id === id)?.name
      return setRowError({
        id,
        msg: `${person} is the only person on ${blocking.map((i) => `"${i.name}"`).join(', ')}. Add someone else to ${blocking.length > 1 ? 'those items' : 'that item'} or delete ${blocking.length > 1 ? 'them' : 'it'} first.`,
      })
    }
    setRowError(null)
    setBill((b) => ({
      ...b,
      people: b.people.filter((p) => p.id !== id),
      items: b.items.map((i) => ({ ...i, sharedBy: i.sharedBy.filter((s) => s !== id) })),
      // Keep the amount they paid but un-assign it, so the payer row asks "Choose who paid."
      payments: b.payments.map((p) => (p.personId === id ? { ...p, personId: '' } : p)),
    }))
  }

  return (
    <section className={card} aria-labelledby="people-h">
      <h2 id="people-h" className="text-lg font-semibold">
        People
      </h2>
      <form onSubmit={add} className="mt-3 flex gap-2" noValidate>
        <div className="flex-1">
          <label htmlFor="new-person" className="sr-only">
            Person name
          </label>
          <input
            id="new-person"
            className={input}
            placeholder="Add a name, e.g. Alex"
            value={name}
            aria-invalid={!!error}
            aria-describedby={error ? 'new-person-err' : undefined}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
          />
        </div>
        <button type="submit" className={`${btnPrimary} shrink-0`}>
          Add person
        </button>
      </form>
      <FieldError id="new-person-err" msg={error} />

      {bill.people.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No one yet. Add everyone at the table.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100" aria-label="People list">
          {bill.people.map((p) => (
            <li key={p.id} className="py-2" data-testid="person-row">
              {editingId === p.id ? (
                <form
                  className="flex flex-wrap gap-2"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault()
                    saveRename(p.id)
                  }}
                >
                  <input
                    autoFocus
                    aria-label={`New name for ${p.name}`}
                    className={`${input} min-w-0 flex-1`}
                    value={editName}
                    aria-invalid={!!editError}
                    onChange={(e) => {
                      setEditName(e.target.value)
                      setEditError(null)
                    }}
                    onKeyDown={(e) => e.key === 'Escape' && setEditingId(null)}
                  />
                  <div className="flex gap-2">
                    <button type="submit" className={btnPrimary}>
                      Save
                    </button>
                    <button type="button" className={btnGhost} onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                  <div className="w-full">
                    <FieldError id={`rename-err-${p.id}`} msg={editError} />
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <button
                    className={btnGhost}
                    aria-label={`Rename ${p.name}`}
                    onClick={() => {
                      setEditingId(p.id)
                      setEditName(p.name)
                      setEditError(null)
                    }}
                  >
                    Rename
                  </button>
                  <button className={btnDanger} aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)}>
                    Remove
                  </button>
                </div>
              )}
              {rowError?.id === p.id && <FieldError id={`row-err-${p.id}`} msg={rowError.msg} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------- Items ----------------

function ItemsSection({
  bill,
  setBill,
  money,
}: {
  bill: Bill
  setBill: React.Dispatch<React.SetStateAction<Bill>>
  money: (c: number) => string
}) {
  const blank = (): ItemDraft => ({ name: '', priceText: '', sharedBy: bill.people.map((p) => p.id) })
  const [draft, setDraft] = useState<ItemDraft>(blank)
  const [errors, setErrors] = useState<ItemErrors>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const knownPeople = useRef(bill.people.map((p) => p.id))

  // Keep the draft's people in sync: drop removed people, and while adding a new
  // item pre-select newly added people (the common case is "everyone shared it").
  useEffect(() => {
    const ids = bill.people.map((p) => p.id)
    const added = ids.filter((id) => !knownPeople.current.includes(id))
    knownPeople.current = ids
    setDraft((d) => ({
      ...d,
      sharedBy: [...d.sharedBy.filter((id) => ids.includes(id)), ...(editingId ? [] : added)],
    }))
  }, [bill.people, editingId])

  // If the bill is reset or the edited item disappears, leave edit mode.
  useEffect(() => {
    if (editingId && !bill.items.some((i) => i.id === editingId)) {
      setEditingId(null)
      setDraft(blank())
      setErrors({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill.items, editingId])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const { errors: errs, priceCents } = validateItem(draft)
    setErrors(errs)
    if (Object.keys(errs).length || priceCents === undefined) return
    const item = { name: draft.name.trim(), priceCents, sharedBy: bill.people.map((p) => p.id).filter((id) => draft.sharedBy.includes(id)) }
    setBill((b) => ({
      ...b,
      items: editingId ? b.items.map((i) => (i.id === editingId ? { ...i, ...item } : i)) : [...b.items, { id: newId(), ...item }],
    }))
    setEditingId(null)
    setDraft(blank())
  }

  const startEdit = (id: string) => {
    const item = bill.items.find((i) => i.id === id)!
    setEditingId(id)
    setErrors({})
    setDraft({ name: item.name, priceText: (item.priceCents / 100).toFixed(2), sharedBy: [...item.sharedBy] })
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    formRef.current?.querySelector('input')?.focus({ preventScroll: true })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft(blank())
    setErrors({})
  }

  const toggle = (id: string) => {
    setDraft((d) => ({ ...d, sharedBy: d.sharedBy.includes(id) ? d.sharedBy.filter((x) => x !== id) : [...d.sharedBy, id] }))
    setErrors((e) => ({ ...e, sharedBy: undefined }))
  }

  const names = new Map(bill.people.map((p) => [p.id, p.name]))
  const allSelected = bill.people.length > 0 && bill.people.every((p) => draft.sharedBy.includes(p.id))

  return (
    <section className={card} aria-labelledby="items-h">
      <h2 id="items-h" className="text-lg font-semibold">
        Items
      </h2>

      <form
        ref={formRef}
        onSubmit={submit}
        noValidate
        aria-label={editingId ? 'Edit item' : 'Add item'}
        className={`mt-3 rounded-xl p-3 ${editingId ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-slate-50'}`}
      >
        {editingId && <p className="mb-2 text-sm font-medium text-amber-800">Editing item</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <div>
            <label htmlFor="item-name" className="mb-1 block text-sm font-medium">
              Item name
            </label>
            <input
              id="item-name"
              className={input}
              placeholder="e.g. Margherita pizza"
              value={draft.name}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'item-name-err' : undefined}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value })
                setErrors({ ...errors, name: undefined })
              }}
            />
            <FieldError id="item-name-err" msg={errors.name} />
          </div>
          <div>
            <label htmlFor="item-price" className="mb-1 block text-sm font-medium">
              Price ({bill.currency})
            </label>
            <input
              id="item-price"
              className={input}
              inputMode="decimal"
              placeholder="0.00"
              value={draft.priceText}
              aria-invalid={!!errors.price}
              aria-describedby={errors.price ? 'item-price-err' : undefined}
              onChange={(e) => {
                setDraft({ ...draft, priceText: e.target.value })
                setErrors({ ...errors, price: undefined })
              }}
            />
            <FieldError id="item-price-err" msg={errors.price} />
          </div>
        </div>

        <fieldset className="mt-3" aria-describedby={errors.sharedBy ? 'item-shared-err' : undefined}>
          <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium">
            Shared by
          </legend>
          {bill.people.length === 0 ? (
            <p className="text-sm text-slate-500">Add people above first.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {bill.people.map((p) => {
                const on = draft.sharedBy.includes(p.id)
                return (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1 transition ${
                      on ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(p.id)} />
                    <span aria-hidden>{on ? '✓' : '+'}</span>
                    {p.name}
                  </label>
                )
              })}
              <button
                type="button"
                className="rounded-full px-3 py-1.5 text-sm text-emerald-700 underline-offset-2 hover:underline"
                onClick={() => {
                  setDraft({ ...draft, sharedBy: allSelected ? [] : bill.people.map((p) => p.id) })
                  setErrors({ ...errors, sharedBy: undefined })
                }}
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
          )}
          <FieldError id="item-shared-err" msg={errors.sharedBy} />
        </fieldset>

        <div className="mt-3 flex gap-2">
          <button type="submit" className={btnPrimary}>
            {editingId ? 'Save item' : 'Add item'}
          </button>
          {editingId && (
            <button type="button" className={btnGhost} onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {bill.items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No items yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100" aria-label="Items list">
          {bill.items.map((item) => (
            <li key={item.id} data-testid="item-row" className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-2 ${editingId === item.id ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{item.name}</span>
                  <span className="shrink-0 tabular-nums">{money(item.priceCents)}</span>
                </div>
                <p className="break-words text-sm text-slate-500">{item.sharedBy.map((id) => names.get(id)).join(', ')}</p>
              </div>
              <div className="flex gap-2">
                <button className={btnGhost} aria-label={`Edit ${item.name}`} onClick={() => startEdit(item.id)}>
                  Edit
                </button>
                <button
                  className={btnDanger}
                  aria-label={`Remove ${item.name}`}
                  onClick={() => setBill((b) => ({ ...b, items: b.items.filter((i) => i.id !== item.id) }))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------- Tax & tip ----------------

function TaxTipSection({
  bill,
  update,
  taxError,
  tipError,
}: {
  bill: Bill
  update: (p: Partial<Bill>) => void
  taxError: string | null
  tipError: string | null
}) {
  return (
    <section className={card} aria-labelledby="taxtip-h">
      <h2 id="taxtip-h" className="text-lg font-semibold">
        Tax &amp; tip
      </h2>
      <div className="mt-3 grid gap-4">
        <div>
          <label htmlFor="tax" className="mb-1 block text-sm font-medium">
            Tax (%)
          </label>
          <input
            id="tax"
            className={input}
            inputMode="decimal"
            placeholder="0"
            value={bill.taxText}
            aria-invalid={!!taxError}
            aria-describedby={taxError ? 'tax-err' : undefined}
            onChange={(e) => update({ taxText: e.target.value })}
          />
          <FieldError id="tax-err" msg={taxError} />
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium" id="tip-label">
            Tip (%)
          </span>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap" role="group" aria-labelledby="tip-label">
            {TIP_PRESETS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={bill.tipPreset === t}
                onClick={() => update({ tipPreset: bill.tipPreset === t ? null : t })}
                className={`${btn} flex-1 ring-1 ${
                  bill.tipPreset === t ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-100'
                }`}
              >
                {t}%
              </button>
            ))}
            <label htmlFor="custom-tip" className="sr-only">
              Custom tip percentage
            </label>
            <input
              id="custom-tip"
              className={`${input} min-w-0 basis-full sm:basis-0 sm:flex-[1.4] ${bill.tipPreset === null && bill.customTipText ? 'border-emerald-500' : ''}`}
              inputMode="decimal"
              placeholder="Custom %"
              value={bill.customTipText}
              aria-invalid={!!tipError}
              aria-describedby={tipError ? 'tip-err' : undefined}
              onFocus={() => bill.customTipText && update({ tipPreset: null })}
              onChange={(e) => update({ customTipText: e.target.value, tipPreset: null })}
            />
          </div>
          <FieldError id="tip-err" msg={tipError} />
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Tax and tip are both calculated on the items subtotal and shared in proportion to what each person ordered.
      </p>
    </section>
  )
}

// ---------------- Who paid ----------------

function PaymentsSection({
  bill,
  setBill,
  check,
  total,
  money,
}: {
  bill: Bill
  setBill: React.Dispatch<React.SetStateAction<Bill>>
  check: PaymentsCheck
  total: number
  money: (c: number) => string
}) {
  const used = new Set(bill.payments.map((p) => p.personId))
  const rowCents = new Map(check.rows.map((r) => [r.id, r.cents]))
  /** What's left of the bill once every other row's (valid) amount is counted. */
  const remainingExcept = (id: string | null) =>
    total - bill.payments.reduce((s, p) => s + (p.id === id ? 0 : (rowCents.get(p.id) ?? 0)), 0)
  const centsText = (c: number) => (c / 100).toFixed(2)

  const patch = (id: string, change: Partial<{ personId: string; amountText: string }>) =>
    setBill((b) => ({ ...b, payments: b.payments.map((p) => (p.id === id ? { ...p, ...change } : p)) }))

  const addPayer = () => {
    const next = bill.people.find((p) => !used.has(p.id))
    const rest = remainingExcept(null)
    setBill((b) => ({
      ...b,
      payments: [...b.payments, { id: newId(), personId: next?.id ?? '', amountText: rest > 0 ? centsText(rest) : '' }],
    }))
  }

  const canAdd = bill.people.length > 0 && bill.payments.length < bill.people.length

  return (
    <section className={card} aria-labelledby="paid-h">
      <h2 id="paid-h" className="text-lg font-semibold">
        Who paid
      </h2>
      <p className="mt-1 text-sm text-slate-500">Record who paid the restaurant and how much. The amounts must add up to the bill total.</p>

      {bill.payments.length > 0 && (
        <ul className="mt-3 grid gap-3" aria-label="Payers">
          {bill.payments.map((p, i) => {
            const row = check.rows[i]
            const rest = remainingExcept(p.id)
            return (
              <li
                key={p.id}
                data-testid="payer-row"
                className="grid gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-start sm:bg-transparent sm:p-0 sm:ring-0"
              >
                <div className="min-w-0">
                  <select
                    aria-label={`Payer ${i + 1}`}
                    className={input}
                    value={p.personId}
                    aria-invalid={!!row.personError}
                    aria-describedby={row.personError ? `payer-err-${p.id}` : undefined}
                    onChange={(e) => patch(p.id, { personId: e.target.value })}
                  >
                    <option value="">Who paid?</option>
                    {bill.people.map((person) => (
                      <option key={person.id} value={person.id} disabled={person.id !== p.personId && used.has(person.id)}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                  <FieldError id={`payer-err-${p.id}`} msg={row.personError} />
                </div>
                <div className="min-w-0">
                  <input
                    aria-label={`Amount paid by payer ${i + 1} (${bill.currency})`}
                    className={input}
                    inputMode="decimal"
                    placeholder={`0.00 ${bill.currency}`}
                    value={p.amountText}
                    aria-invalid={!!row.amountError}
                    aria-describedby={row.amountError ? `amount-err-${p.id}` : undefined}
                    onChange={(e) => patch(p.id, { amountText: e.target.value })}
                  />
                  <FieldError id={`amount-err-${p.id}`} msg={row.amountError} />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`${btnGhost} flex-1 sm:flex-none`}
                    disabled={rest <= 0 || rowCents.get(p.id) === rest}
                    title="Set this amount to whatever is left of the bill"
                    onClick={() => patch(p.id, { amountText: centsText(rest) })}
                  >
                    Pays the rest
                  </button>
                  <button
                    type="button"
                    className={btnDanger}
                    aria-label={`Remove payer ${i + 1}`}
                    onClick={() => setBill((b) => ({ ...b, payments: b.payments.filter((x) => x.id !== p.id) }))}
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={btnPrimary} disabled={!canAdd} onClick={addPayer}>
          Add payer
        </button>
        {bill.payments.length > 0 && (
          <span className="text-sm tabular-nums text-slate-600" data-testid="paid-progress">
            Paid {money(check.paidCents)} of {money(total)}
          </span>
        )}
      </div>
      {bill.people.length === 0 && <p className="mt-2 text-sm text-slate-500">Add people above first.</p>}
      {check.error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200" data-testid="payments-error">
          {check.error}
        </p>
      )}
      {check.ok && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200" data-testid="payments-ok">
          ✓ Payments match the bill total.
        </p>
      )}
    </section>
  )
}

// ---------------- Settle up ----------------

function SettleUpSection({ bill, check, totals }: { bill: Bill; check: PaymentsCheck; totals: ReturnType<typeof computeTotals> }) {
  const names = new Map(bill.people.map((p) => [p.id, p.name]))
  const transfers = check.ok ? settleUp(balances(totals, check.paidByPerson)) : []
  return (
    <section className={card} aria-labelledby="settle-h">
      <h2 id="settle-h" className="text-lg font-semibold">
        Settle up
      </h2>
      {bill.payments.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Add who paid to see who owes whom.</p>
      ) : !check.ok ? (
        <p className="mt-2 text-sm text-amber-800" data-testid="settle-blocked">
          Fix the payments in “Who paid” so they add up to the bill total, then the transfers will appear here.
        </p>
      ) : transfers.length === 0 ? (
        <p className="mt-2 text-sm text-emerald-800">Everyone is even. No transfers needed.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">
            The fewest transfers that even everyone out ({transfers.length} {transfers.length === 1 ? 'transfer' : 'transfers'}).
          </p>
          <ul className="mt-3 grid gap-2" aria-label="Transfers">
            {transfers.map((t) => (
              <li key={`${t.from}-${t.to}`} data-testid="transfer" className="rounded-xl bg-slate-50 px-3 py-2 tabular-nums break-words">
                {transferText(t, names, bill.currency)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

// ---------------- Breakdown ----------------

function Breakdown({
  totals,
  money,
  taxPct,
  tipPct,
}: {
  totals: ReturnType<typeof computeTotals>
  money: (c: number) => string
  taxPct: number
  tipPct: number
}) {
  return (
    <section className={card} aria-labelledby="breakdown-h">
      <h2 id="breakdown-h" className="text-lg font-semibold">
        Per-person breakdown
      </h2>
      {totals.perPerson.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Add people and items to see who owes what.</p>
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className="mt-3 hidden overflow-x-auto sm:block">
            <table className="w-full text-sm tabular-nums" data-testid="breakdown-table">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-2 font-medium">Person</th>
                  <th className="py-2 px-2 text-right font-medium">Items</th>
                  <th className="py-2 px-2 text-right font-medium">Tax</th>
                  <th className="py-2 px-2 text-right font-medium">Tip</th>
                  <th className="py-2 pl-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {totals.perPerson.map((p) => (
                  <tr key={p.personId} className="border-b border-slate-100" data-testid="breakdown-row">
                    <td className="max-w-[10rem] truncate py-2 pr-2 font-medium">{p.name}</td>
                    <td className="py-2 px-2 text-right">{money(p.subtotal)}</td>
                    <td className="py-2 px-2 text-right">{money(p.tax)}</td>
                    <td className="py-2 px-2 text-right">{money(p.tip)}</td>
                    <td className="py-2 pl-2 text-right font-semibold">{money(p.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 pr-2">Bill total</td>
                  <td className="py-2 px-2 text-right">{money(totals.subtotal)}</td>
                  <td className="py-2 px-2 text-right">{money(totals.tax)}</td>
                  <td className="py-2 px-2 text-right">{money(totals.tip)}</td>
                  <td className="py-2 pl-2 text-right text-emerald-700" data-testid="bill-total">
                    {money(totals.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile: cards */}
          <ul className="mt-3 grid gap-2 sm:hidden" data-testid="breakdown-cards">
            {totals.perPerson.map((p) => (
              <li key={p.personId} className="rounded-xl bg-slate-50 p-3 tabular-nums">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{p.name}</span>
                  <span className="text-lg font-bold">{money(p.total)}</span>
                </div>
                <dl className="mt-1 grid grid-cols-3 gap-1 text-xs text-slate-600">
                  <div>
                    <dt>Items</dt>
                    <dd className="text-slate-900">{money(p.subtotal)}</dd>
                  </div>
                  <div>
                    <dt>Tax</dt>
                    <dd className="text-slate-900">{money(p.tax)}</dd>
                  </div>
                  <div>
                    <dt>Tip</dt>
                    <dd className="text-slate-900">{money(p.tip)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}

      <dl className="mt-4 grid gap-1 border-t border-slate-200 pt-3 text-sm tabular-nums">
        <div className="flex justify-between">
          <dt className="text-slate-600">Items subtotal</dt>
          <dd>{money(totals.subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-600">Tax ({Number(taxPct.toFixed(4))}%)</dt>
          <dd>{money(totals.tax)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-600">Tip ({Number(tipPct.toFixed(4))}%)</dt>
          <dd>{money(totals.tip)}</dd>
        </div>
        <div className="mt-1 flex justify-between text-base font-bold">
          <dt>Total</dt>
          <dd data-testid="grand-total">{money(totals.total)}</dd>
        </div>
      </dl>
    </section>
  )
}
