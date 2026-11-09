import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CURRENCIES,
  buildSummary,
  calculate,
  emptyBill,
  formatMoney,
  loadBill,
  parsePercent,
  parsePrice,
  checkPayments,
  paymentMessage,
  settlement,
  transferText,
  type Bill,
  type Currency,
} from './lib/bill'

const STORAGE_KEY = 'bill-splitter:v1'
const PRESETS = ['10', '15', '18', '20']
const uid = () => Math.random().toString(36).slice(2, 10)

const input =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:outline-2 focus:outline-indigo-500'
const btn =
  'rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-indigo-500'
const btnPrimary = `${btn} bg-indigo-600 text-white hover:bg-indigo-700`
const btnGhost = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`

function Err({ id, children }: { id?: string; children?: string }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-red-600">
      {children}
    </p>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

function initial(): Bill {
  try {
    return loadBill(localStorage.getItem(STORAGE_KEY))
  } catch {
    return emptyBill()
  }
}

export default function App() {
  const [bill, setBill] = useState<Bill>(initial)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bill))
    } catch {
      /* storage unavailable; app still works for this session */
    }
  }, [bill])

  const totals = useMemo(() => calculate(bill), [bill])
  const money = (c: number) => formatMoney(c, bill.currency)
  const patch = (p: Partial<Bill>) => setBill((b) => ({ ...b, ...p }))

  // ---- people ----
  const [newPerson, setNewPerson] = useState('')
  const [personError, setPersonError] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [renameError, setRenameError] = useState('')

  const nameTaken = (name: string, exceptId?: string) =>
    bill.people.some((p) => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase())

  function addPerson(e: React.FormEvent) {
    e.preventDefault()
    const name = newPerson.trim()
    if (!name) return setPersonError('Enter a name.')
    if (nameTaken(name)) return setPersonError(`"${name}" is already on the list.`)
    patch({ people: [...bill.people, { id: uid(), name }] })
    setNewPerson('')
    setPersonError('')
  }
  function saveRename(e: React.FormEvent) {
    e.preventDefault()
    if (!renaming) return
    const name = renaming.name.trim()
    if (!name) return setRenameError('Name cannot be empty.')
    if (nameTaken(name, renaming.id)) return setRenameError(`"${name}" is already on the list.`)
    patch({ people: bill.people.map((p) => (p.id === renaming.id ? { ...p, name } : p)) })
    setRenaming(null)
    setRenameError('')
  }
  function removePerson(id: string) {
    patch({
      people: bill.people.filter((p) => p.id !== id),
      items: bill.items.map((i) => ({ ...i, people: i.people.filter((p) => p !== id) })),
      payers: bill.payers.filter((p) => p.personId !== id),
    })
    setSelected((s) => s.filter((p) => p !== id))
  }

  // ---- items ----
  const [editingId, setEditingId] = useState<string | null>(null)
  const [itemName, setItemName] = useState('')
  const [itemPrice, setItemPrice] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [itemErrors, setItemErrors] = useState<{ name?: string; price?: string; people?: string }>({})
  const itemNameRef = useRef<HTMLInputElement>(null)

  function resetItemForm() {
    setEditingId(null)
    setItemName('')
    setItemPrice('')
    setSelected([])
    setItemErrors({})
  }
  function submitItem(e: React.FormEvent) {
    e.preventDefault()
    const errors: typeof itemErrors = {}
    const name = itemName.trim()
    if (!name) errors.name = 'Enter an item name.'
    const price = parsePrice(itemPrice)
    if (price.error) errors.price = price.error
    if (selected.length === 0) errors.people = 'Select at least one person who shared this item.'
    setItemErrors(errors)
    if (Object.keys(errors).length) return
    const item = { id: editingId ?? uid(), name, cents: price.cents!, people: selected }
    patch({
      items: editingId ? bill.items.map((i) => (i.id === editingId ? item : i)) : [...bill.items, item],
    })
    resetItemForm()
    itemNameRef.current?.focus()
  }
  function startEdit(id: string) {
    const it = bill.items.find((i) => i.id === id)
    if (!it) return
    setEditingId(id)
    setItemName(it.name)
    setItemPrice((it.cents / 100).toFixed(2))
    setSelected(it.people)
    setItemErrors({})
    itemNameRef.current?.focus()
    itemNameRef.current?.scrollIntoView({ block: 'center' })
  }
  function removeItem(id: string) {
    patch({ items: bill.items.filter((i) => i.id !== id) })
    if (editingId === id) resetItemForm()
  }
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  // ---- payers / settle up ----
  const payCheck = checkPayments(bill, totals)
  const transfers = settlement(bill, totals)
  const unusedPeople = bill.people.filter((p) => !bill.payers.some((x) => x.personId === p.id))
  const setPayer = (personId: string, p: Partial<{ personId: string; amount: string }>) =>
    patch({ payers: bill.payers.map((x) => (x.personId === personId ? { ...x, ...p } : x)) })
  function addPayer() {
    const next = unusedPeople[0]
    if (!next) return
    const amount = payCheck.diff > 0 ? (payCheck.diff / 100).toFixed(2) : ''
    patch({ payers: [...bill.payers, { personId: next.id, amount }] })
  }

  // ---- tax / tip ----
  const taxErr = parsePercent(bill.tax, 'Tax').error
  const tipErr = parsePercent(bill.tip, 'Tip').error
  const tipPreset = PRESETS.find((p) => !tipErr && parsePercent(bill.tip, 'Tip').bp === Number(p) * 100)

  // ---- copy / reset ----
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [confirmReset, setConfirmReset] = useState(false)
  async function copy() {
    const text = buildSummary(bill)
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('ok')
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        setCopyState(ok ? 'ok' : 'fail')
      } catch {
        setCopyState('fail')
      }
    }
    setTimeout(() => setCopyState('idle'), 2500)
  }
  function doReset() {
    setBill(emptyBill())
    resetItemForm()
    setNewPerson('')
    setPersonError('')
    setRenaming(null)
    setConfirmReset(false)
  }

  const nameOf = (id: string) => bill.people.find((p) => p.id === id)?.name ?? '?'
  const invalidItems = bill.items.filter((i) => i.people.length === 0)

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-indigo-700 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <h1 className="text-xl font-bold sm:text-2xl">Split the Bill</h1>
          <div className="flex items-center gap-2">
            <label htmlFor="currency" className="text-sm">
              Currency
            </label>
            <select
              id="currency"
              value={bill.currency}
              onChange={(e) => patch({ currency: e.target.value as Currency })}
              className="rounded-md bg-white px-2 py-1.5 text-sm text-slate-900"
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className={`${btn} border border-white/60 text-white hover:bg-white/10`}
            >
              Reset
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-4 px-4 py-4 md:grid-cols-2 md:items-start">
        <div className="grid gap-4">
          <Card title="People">
            <form onSubmit={addPerson} className="flex gap-2" noValidate>
              <input
                aria-label="Person name"
                placeholder="Add a person"
                value={newPerson}
                onChange={(e) => setNewPerson(e.target.value)}
                className={input}
                maxLength={40}
              />
              <button className={btnPrimary}>Add</button>
            </form>
            <Err>{personError}</Err>
            {bill.people.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No one yet. Add the people at the table.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100" aria-label="People">
                {bill.people.map((p) => (
                  <li key={p.id} className="py-2" data-testid="person">
                    {renaming?.id === p.id ? (
                      <form onSubmit={saveRename} noValidate>
                        <div className="flex gap-2">
                          <input
                            aria-label={`New name for ${p.name}`}
                            autoFocus
                            value={renaming.name}
                            onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                            className={input}
                            maxLength={40}
                          />
                          <button className={btnPrimary}>Save</button>
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => {
                              setRenaming(null)
                              setRenameError('')
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                        <Err>{renameError}</Err>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{p.name}</span>
                        <span className="flex shrink-0 gap-2">
                          <button
                            className={btnGhost}
                            onClick={() => {
                              setRenaming({ id: p.id, name: p.name })
                              setRenameError('')
                            }}
                            aria-label={`Rename ${p.name}`}
                          >
                            Rename
                          </button>
                          <button className={btnGhost} onClick={() => removePerson(p.id)} aria-label={`Remove ${p.name}`}>
                            Remove
                          </button>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={editingId ? 'Edit item' : 'Items'}>
            <form onSubmit={submitItem} noValidate className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <div>
                  <label htmlFor="item-name" className="mb-1 block text-sm font-medium">
                    Item
                  </label>
                  <input
                    id="item-name"
                    ref={itemNameRef}
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="e.g. Margherita"
                    className={input}
                    aria-invalid={!!itemErrors.name}
                    aria-describedby={itemErrors.name ? 'item-name-err' : undefined}
                    maxLength={60}
                  />
                  <Err id="item-name-err">{itemErrors.name}</Err>
                </div>
                <div>
                  <label htmlFor="item-price" className="mb-1 block text-sm font-medium">
                    Price
                  </label>
                  <input
                    id="item-price"
                    inputMode="decimal"
                    value={itemPrice}
                    onChange={(e) => setItemPrice(e.target.value)}
                    placeholder="0.00"
                    className={input}
                    aria-invalid={!!itemErrors.price}
                    aria-describedby={itemErrors.price ? 'item-price-err' : undefined}
                  />
                  <Err id="item-price-err">{itemErrors.price}</Err>
                </div>
              </div>
              <fieldset>
                <legend className="mb-1 text-sm font-medium">Shared by</legend>
                {bill.people.length === 0 ? (
                  <p className="text-sm text-slate-500">Add people first.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {bill.people.map((p) => (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                          selected.includes(p.id)
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          onChange={() => toggle(p.id)}
                          className="accent-indigo-600"
                        />
                        {p.name}
                      </label>
                    ))}
                    <button
                      type="button"
                      className="text-sm text-indigo-700 underline"
                      onClick={() => setSelected(selected.length === bill.people.length ? [] : bill.people.map((p) => p.id))}
                    >
                      {selected.length === bill.people.length ? 'Clear' : 'Everyone'}
                    </button>
                  </div>
                )}
                <Err>{itemErrors.people}</Err>
              </fieldset>
              <div className="flex gap-2">
                <button className={btnPrimary}>{editingId ? 'Save item' : 'Add item'}</button>
                {editingId && (
                  <button type="button" className={btnGhost} onClick={resetItemForm}>
                    Cancel
                  </button>
                )}
              </div>
            </form>

            {invalidItems.length > 0 && (
              <p role="alert" className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
                {invalidItems.map((i) => `"${i.name}"`).join(', ')} {invalidItems.length === 1 ? 'has' : 'have'} no one
                assigned (a person was removed) and {invalidItems.length === 1 ? 'is' : 'are'} not counted. Edit{' '}
                {invalidItems.length === 1 ? 'it' : 'them'} to choose who shared.
              </p>
            )}

            {bill.items.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No items yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100" aria-label="Items">
                {bill.items.map((i) => (
                  <li key={i.id} className="py-2" data-testid="item">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {i.name} <span className="font-normal text-slate-600">· {money(i.cents)}</span>
                        </div>
                        <div className="text-sm text-slate-500">
                          {i.people.length ? i.people.map(nameOf).join(', ') : 'No one assigned'}
                        </div>
                      </div>
                      <span className="flex shrink-0 gap-2">
                        <button className={btnGhost} onClick={() => startEdit(i.id)} aria-label={`Edit ${i.name}`}>
                          Edit
                        </button>
                        <button className={btnGhost} onClick={() => removeItem(i.id)} aria-label={`Remove item ${i.name}`}>
                          Remove
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid gap-4">
          <Card title="Tax & tip">
            <div className="grid gap-4">
              <div>
                <label htmlFor="tax" className="mb-1 block text-sm font-medium">
                  Tax (%)
                </label>
                <input
                  id="tax"
                  inputMode="decimal"
                  value={bill.tax}
                  onChange={(e) => patch({ tax: e.target.value })}
                  className={`${input} max-w-32`}
                  aria-invalid={!!taxErr}
                  aria-describedby={taxErr ? 'tax-err' : undefined}
                />
                <Err id="tax-err">{taxErr}</Err>
              </div>
              <div>
                <span className="mb-1 block text-sm font-medium">Tip</span>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tip presets">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={tipPreset === p}
                      onClick={() => patch({ tip: p })}
                      className={`${btn} border ${
                        tipPreset === p
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                  <div className="flex items-center gap-2 sm:ml-2">
                    <label htmlFor="tip" className="text-sm">
                      Custom %
                    </label>
                    <input
                      id="tip"
                      inputMode="decimal"
                      value={bill.tip}
                      onChange={(e) => patch({ tip: e.target.value })}
                      className={`${input} max-w-24`}
                      aria-invalid={!!tipErr}
                      aria-describedby={tipErr ? 'tip-err' : undefined}
                    />
                  </div>
                </div>
                <Err id="tip-err">{tipErr}</Err>
              </div>
            </div>
          </Card>

          <Card title="Breakdown">
            {bill.people.length === 0 ? (
              <p className="text-sm text-slate-500">Add people and items to see who owes what.</p>
            ) : (
              <div className="grid gap-3">
                {totals.shares.map((s) => (
                  <div key={s.person.id} className="rounded-lg border border-slate-200 p-3" data-testid="share">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold">{s.person.name}</span>
                      <span className="text-lg font-bold" data-testid="share-total">
                        {money(s.total)}
                      </span>
                    </div>
                    <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 text-sm text-slate-600">
                      <dt>Items</dt>
                      <dd className="text-right tabular-nums">{money(s.subtotal)}</dd>
                      <dt>Tax</dt>
                      <dd className="text-right tabular-nums">{money(s.tax)}</dd>
                      <dt>Tip</dt>
                      <dd className="text-right tabular-nums">{money(s.tip)}</dd>
                    </dl>
                  </div>
                ))}
                <div className="rounded-lg bg-slate-900 p-3 text-white" data-testid="bill-total">
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-sm text-slate-300">
                    <dt>Subtotal</dt>
                    <dd className="text-right tabular-nums">{money(totals.subtotal)}</dd>
                    <dt>Tax</dt>
                    <dd className="text-right tabular-nums">{money(totals.tax)}</dd>
                    <dt>Tip</dt>
                    <dd className="text-right tabular-nums">{money(totals.tip)}</dd>
                    <dt className="pt-1 text-base font-semibold text-white">Total</dt>
                    <dd className="pt-1 text-right text-base font-bold tabular-nums text-white" data-testid="grand-total">
                      {money(totals.total)}
                    </dd>
                  </dl>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" className={btnPrimary} onClick={copy}>
                    Copy summary
                  </button>
                  <span role="status" className="text-sm">
                    {copyState === 'ok' && <span className="text-green-700">Copied to clipboard!</span>}
                    {copyState === 'fail' && <span className="text-red-600">Could not copy. Please copy manually.</span>}
                  </span>
                </div>
              </div>
            )}
          </Card>

          <Card title="Who paid">
            {bill.people.length === 0 ? (
              <p className="text-sm text-slate-500">Add people first.</p>
            ) : (
              <>
                {bill.payers.length === 0 && (
                  <p className="mb-2 text-sm text-slate-500">Record who paid the bill. Several people can split the payment.</p>
                )}
                <ul className="grid gap-2" aria-label="Payers">
                  {bill.payers.map((p, idx) => {
                    const err = payCheck.rowErrors[idx]
                    const options = bill.people.filter((x) => x.id === p.personId || unusedPeople.includes(x))
                    const name = bill.people.find((x) => x.id === p.personId)?.name ?? ''
                    return (
                      <li key={idx} data-testid="payer">
                        <div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_8rem_auto]">
                          <select
                            aria-label={`Payer ${idx + 1}`}
                            value={p.personId}
                            onChange={(e) => setPayer(p.personId, { personId: e.target.value })}
                            className={`${input} col-span-2 min-w-0 sm:col-span-1`}
                          >
                            {options.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label={`Amount paid by ${name}`}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={p.amount}
                            onChange={(e) => setPayer(p.personId, { amount: e.target.value })}
                            className={`${input} min-w-0`}
                            aria-invalid={!!err}
                          />
                          <button
                            className={btnGhost}
                            aria-label={`Remove payer ${name}`}
                            onClick={() => patch({ payers: bill.payers.filter((x) => x.personId !== p.personId) })}
                          >
                            Remove
                          </button>
                        </div>
                        <Err>{err}</Err>
                      </li>
                    )
                  })}
                </ul>
                <button className={`${btnGhost} mt-3`} onClick={addPayer} disabled={unusedPeople.length === 0}>
                  Add payer
                </button>
                {payCheck.status !== 'none' && (
                  <p
                    data-testid="payment-status"
                    role={payCheck.status === 'ok' ? 'status' : 'alert'}
                    className={`mt-3 text-sm ${payCheck.status === 'ok' ? 'text-green-700' : 'text-red-600'}`}
                  >
                    {paymentMessage(payCheck, bill.currency)}
                  </p>
                )}
              </>
            )}
          </Card>

          <Card title="Settle up">
            {transfers === null ? (
              <p className="text-sm text-slate-500" data-testid="settle-hint">
                {bill.people.length === 0 ? 'Add people and items first.' : paymentMessage(payCheck, bill.currency)}
              </p>
            ) : transfers.length === 0 ? (
              <p className="text-sm text-slate-700" data-testid="settle-even">
                Everyone is even. No transfers needed.
              </p>
            ) : (
              <ul className="grid gap-2" aria-label="Transfers">
                {transfers.map((t, i) => (
                  <li key={i} data-testid="transfer" className="rounded-lg border border-slate-200 p-3 font-medium">
                    {transferText(t, bill.currency)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </main>

      {confirmReset && (
        <div className="fixed inset-0 z-10 grid place-items-center bg-black/50 p-4" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="reset-title" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 id="reset-title" className="text-lg font-semibold">
              Reset the bill?
            </h2>
            <p className="mt-1 text-sm text-slate-600">This removes all people, items, tax and tip. It can't be undone.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button autoFocus className={btnGhost} onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button className={`${btn} bg-red-600 text-white hover:bg-red-700`} onClick={doReset}>
                Yes, reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
