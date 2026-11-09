import { useEffect, useMemo, useState } from 'react'
import {
  CURRENCIES, buildSummary, calculate, checkPayments, displayName, emptyBill, formatMoney, loadBill, parsePrice, saveBill, settleUp,
  type Bill, type Currency, type Item,
} from './lib/split'

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const PRESETS = [10, 15, 18, 20]

const card = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5'
const input = 'min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-emerald-600 focus:outline-2 focus:outline-emerald-600/30'
const btn = 'rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600'
const btnPrimary = `${btn} bg-emerald-700 text-white hover:bg-emerald-800`
const btnSecondary = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`
const btnDanger = `${btn} border border-red-200 bg-white text-red-700 hover:bg-red-50`
const errCls = 'mt-1 text-sm text-red-700'

function Err({ children, id }: { children?: string; id?: string }) {
  return children ? <p id={id} role="alert" className={errCls}>{children}</p> : null
}

export default function App() {
  const [bill, setBill] = useState<Bill>(() => loadBill())
  useEffect(() => saveBill(bill), [bill])
  const patch = (p: Partial<Bill>) => setBill((b) => ({ ...b, ...p }))
  const r = useMemo(() => calculate(bill), [bill])
  const money = (c: number) => formatMoney(c, bill.currency)

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 text-slate-900 sm:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Split the bill</h1>
          <p className="text-sm text-slate-600">Add people and items, then see who owes what.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          Currency
          <select
            className={input}
            value={bill.currency}
            onChange={(e) => patch({ currency: e.target.value as Currency })}
          >
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <People bill={bill} setBill={setBill} />
          <Items bill={bill} setBill={setBill} unassigned={r.unassigned} money={money} />
          <TaxTip bill={bill} patch={patch} taxError={r.taxError} tipError={r.tipError} />
          <Payers bill={bill} r={r} setBill={setBill} money={money} />
        </div>
        <div className="space-y-5">
          <Breakdown bill={bill} r={r} money={money} />
          <SettleUp bill={bill} r={r} money={money} />
          <Actions bill={bill} onReset={() => setBill(emptyBill())} summary={() => buildSummary(bill, r)} />
        </div>
      </div>
    </div>
  )
}

function People({ bill, setBill }: { bill: Bill; setBill: React.Dispatch<React.SetStateAction<Bill>> }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [editError, setEditError] = useState('')

  const dupe = (n: string, except?: string) =>
    bill.people.some((p) => p.id !== except && p.name.trim().toLowerCase() === n.toLowerCase())

  function add(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError('Enter a name.')
    if (dupe(n)) return setError(`There is already someone called "${n}".`)
    setBill((b) => ({ ...b, people: [...b.people, { id: uid(), name: n }] }))
    setName(''); setError('')
  }
  function saveEdit(id: string) {
    const n = draft.trim()
    if (!n) return setEditError('Name cannot be empty.')
    if (dupe(n, id)) return setEditError(`There is already someone called "${n}".`)
    setBill((b) => ({ ...b, people: b.people.map((p) => (p.id === id ? { ...p, name: n } : p)) }))
    setEditing(null); setEditError('')
  }
  function remove(id: string) {
    setBill((b) => ({
      ...b,
      people: b.people.filter((p) => p.id !== id),
      payers: b.payers.filter((p) => p.personId !== id),
      items: b.items.map((i) => ({ ...i, people: i.people.filter((x) => x !== id) })),
    }))
  }

  return (
    <section className={card} aria-labelledby="people-h">
      <h2 id="people-h" className="mb-3 text-lg font-semibold">People</h2>
      <form onSubmit={add} className="flex gap-2" noValidate>
        <input
          className={`${input} flex-1`} aria-label="New person name" placeholder="Name"
          value={name} onChange={(e) => { setName(e.target.value); setError('') }}
          aria-invalid={!!error} aria-describedby="person-err"
        />
        <button className={btnPrimary} type="submit">Add person</button>
      </form>
      <Err id="person-err">{error}</Err>
      {bill.people.length === 0 && <p className="mt-3 text-sm text-slate-500">No one yet. Add the people at the table.</p>}
      <ul className="mt-3 divide-y divide-slate-100">
        {bill.people.map((p, idx) => (
          <li key={p.id} className="py-2" data-testid="person-row">
            {editing === p.id ? (
              <div>
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => { e.preventDefault(); saveEdit(p.id) }}
                  noValidate
                >
                  <input
                    className={`${input} flex-1`} aria-label={`Rename ${displayName(p, idx)}`} autoFocus value={draft}
                    onChange={(e) => { setDraft(e.target.value); setEditError('') }}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(null); setEditError('') } }}
                  />
                  <button className={btnPrimary} type="submit">Save</button>
                  <button className={btnSecondary} type="button" onClick={() => { setEditing(null); setEditError('') }}>Cancel</button>
                </form>
                <Err>{editError}</Err>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{displayName(p, idx)}</span>
                <button className={btnSecondary} onClick={() => { setEditing(p.id); setDraft(p.name); setEditError('') }} aria-label={`Rename ${displayName(p, idx)}`}>Rename</button>
                <button className={btnDanger} onClick={() => remove(p.id)} aria-label={`Remove ${displayName(p, idx)}`}>Remove</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Items({ bill, setBill, unassigned, money }: {
  bill: Bill; setBill: React.Dispatch<React.SetStateAction<Bill>>; unassigned: Item[]; money: (c: number) => string
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [who, setWho] = useState<string[]>([])
  const [errors, setErrors] = useState<{ name?: string; price?: string; who?: string }>({})

  const clear = () => { setEditingId(null); setName(''); setPrice(''); setWho([]); setErrors({}) }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!name.trim()) errs.name = 'Enter an item name.'
    const p = parsePrice(price)
    if (p.error) errs.price = p.error
    if (who.length === 0) errs.who = bill.people.length ? 'Pick at least one person who shared this item.' : 'Add a person first, then pick who shared this item.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const item: Item = { id: editingId ?? uid(), name: name.trim(), cents: p.cents!, people: who }
    setBill((b) => ({
      ...b,
      items: editingId ? b.items.map((i) => (i.id === editingId ? item : i)) : [...b.items, item],
    }))
    clear()
  }

  function edit(i: Item) {
    setEditingId(i.id); setName(i.name); setPrice((i.cents / 100).toFixed(2)); setWho(i.people.filter((id) => bill.people.some((p) => p.id === id))); setErrors({})
    document.getElementById('item-name')?.focus()
  }

  const toggle = (id: string) => { setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id])); setErrors((e) => ({ ...e, who: undefined })) }
  const nameOf = (id: string) => { const idx = bill.people.findIndex((p) => p.id === id); return idx < 0 ? '' : displayName(bill.people[idx], idx) }

  return (
    <section className={card} aria-labelledby="items-h">
      <h2 id="items-h" className="mb-3 text-lg font-semibold">Items</h2>
      <form onSubmit={submit} noValidate className="space-y-3" aria-label={editingId ? 'Edit item' : 'Add item'}>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <div>
            <label className="text-sm font-medium" htmlFor="item-name">Item name</label>
            <input id="item-name" className={`${input} mt-1 w-full`} placeholder="Margherita pizza" value={name}
              onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })) }} aria-invalid={!!errors.name} />
            <Err>{errors.name}</Err>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="item-price">Price</label>
            <input id="item-price" className={`${input} mt-1 w-full`} inputMode="decimal" placeholder="0.00" value={price}
              onChange={(e) => { setPrice(e.target.value); setErrors((x) => ({ ...x, price: undefined })) }} aria-invalid={!!errors.price} />
            <Err>{errors.price}</Err>
          </div>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Shared by</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {bill.people.length === 0 && <span className="text-sm text-slate-500">Add people first.</span>}
            {bill.people.map((p, idx) => (
              <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${who.includes(p.id) ? 'border-emerald-700 bg-emerald-50' : 'border-slate-300'}`}>
                <input type="checkbox" className="accent-emerald-700" checked={who.includes(p.id)} onChange={() => toggle(p.id)} />
                {displayName(p, idx)}
              </label>
            ))}
            {bill.people.length > 1 && (
              <button type="button" className="text-sm text-emerald-800 underline" onClick={() => { setWho(bill.people.map((p) => p.id)); setErrors((e) => ({ ...e, who: undefined })) }}>Everyone</button>
            )}
          </div>
          <Err>{errors.who}</Err>
        </fieldset>
        <div className="flex gap-2">
          <button className={btnPrimary} type="submit">{editingId ? 'Save item' : 'Add item'}</button>
          {editingId && <button className={btnSecondary} type="button" onClick={clear}>Cancel</button>}
        </div>
      </form>

      {unassigned.length > 0 && (
        <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {unassigned.map((i) => i.name).join(', ')} {unassigned.length === 1 ? 'has' : 'have'} nobody assigned and {unassigned.length === 1 ? 'is' : 'are'} not counted. Edit {unassigned.length === 1 ? 'it' : 'them'} to pick who shared.
        </p>
      )}
      {bill.items.length === 0 && <p className="mt-3 text-sm text-slate-500">No items yet.</p>}
      <ul className="mt-3 divide-y divide-slate-100">
        {bill.items.map((i) => (
          <li key={i.id} className="flex items-center gap-2 py-2" data-testid="item-row">
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-2"><span className="truncate font-medium">{i.name}</span><span className="tabular-nums">{money(i.cents)}</span></div>
              <div className="truncate text-sm text-slate-600">{i.people.map(nameOf).filter(Boolean).join(', ') || 'Nobody'}</div>
            </div>
            <button className={btnSecondary} onClick={() => edit(i)} aria-label={`Edit ${i.name}`}>Edit</button>
            <button className={btnDanger} onClick={() => { setBill((b) => ({ ...b, items: b.items.filter((x) => x.id !== i.id) })); if (editingId === i.id) clear() }} aria-label={`Remove ${i.name}`}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TaxTip({ bill, patch, taxError, tipError }: { bill: Bill; patch: (p: Partial<Bill>) => void; taxError?: string; tipError?: string }) {
  const tip = bill.tipInput.trim()
  return (
    <section className={card} aria-labelledby="tt-h">
      <h2 id="tt-h" className="mb-3 text-lg font-semibold">Tax and tip</h2>
      <label className="text-sm font-medium" htmlFor="tax">Tax (%)</label>
      <input id="tax" className={`${input} mt-1 block w-32`} inputMode="decimal" placeholder="0" value={bill.taxInput}
        onChange={(e) => patch({ taxInput: e.target.value })} aria-invalid={!!taxError} />
      <Err>{taxError}</Err>
      <div className="mt-4 text-sm font-medium" id="tip-label">Tip</div>
      <div role="group" aria-labelledby="tip-label" className="mt-1 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button key={p} type="button" aria-pressed={tip === String(p)}
            className={`${btn} border ${tip === String(p) ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white hover:bg-slate-100'}`}
            onClick={() => patch({ tipInput: String(p) })}>{p}%</button>
        ))}
        <button type="button" aria-pressed={tip === '' || tip === '0'} className={`${btn} border ${tip === '' || tip === '0' ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white hover:bg-slate-100'}`}
          onClick={() => patch({ tipInput: '' })}>No tip</button>
        <label className="flex items-center gap-2 text-sm">
          Custom %
          <input aria-label="Custom tip percentage" className={`${input} w-24`} inputMode="decimal" placeholder="e.g. 18" value={bill.tipInput}
            onChange={(e) => patch({ tipInput: e.target.value })} aria-invalid={!!tipError} />
        </label>
      </div>
      <Err>{tipError}</Err>
      <p className="mt-3 text-xs text-slate-500">Tax and tip are both calculated on the items subtotal and split in proportion to each person's items.</p>
    </section>
  )
}

function Payers({ bill, r, setBill, money }: {
  bill: Bill; r: ReturnType<typeof calculate>; setBill: React.Dispatch<React.SetStateAction<Bill>>; money: (c: number) => string
}) {
  const check = checkPayments(bill, r)
  const unused = bill.people.filter((p) => !bill.payers.some((x) => x.personId === p.id))
  const setPayer = (i: number, patch: Partial<Bill['payers'][number]>) =>
    setBill((b) => ({ ...b, payers: b.payers.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))
  const remaining = (i: number) => r.total - check.rows.reduce((s, row, j) => s + (j === i ? 0 : row.cents), 0)

  return (
    <section className={card} aria-labelledby="pay-h">
      <h2 id="pay-h" className="mb-1 text-lg font-semibold">Who paid</h2>
      <p className="mb-3 text-sm text-slate-600">Record who paid the restaurant and how much. The amounts must add up to the bill total.</p>
      {bill.people.length === 0 && <p className="text-sm text-slate-500">Add people first.</p>}
      <ul className="space-y-3">
        {bill.payers.map((p, i) => {
          const row = check.rows[i]
          const who = bill.people.find((x) => x.id === p.personId)
          const label = who ? displayName(who, bill.people.indexOf(who)) : 'payer'
          return (
            <li key={i} data-testid="payer-row">
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label={`Payer ${i + 1}`} className={`${input} basis-full sm:basis-0 sm:flex-1`} value={p.personId} onChange={(e) => setPayer(i, { personId: e.target.value })}>
                  {!who && <option value="">Choose person</option>}
                  {bill.people.map((x, idx) => (
                    <option key={x.id} value={x.id} disabled={x.id !== p.personId && bill.payers.some((y) => y.personId === x.id)}>{displayName(x, idx)}</option>
                  ))}
                </select>
                <input aria-label={`Amount paid by ${label}`} className={`${input} w-24 sm:w-28`} inputMode="decimal" placeholder="0.00" value={p.amount}
                  onChange={(e) => setPayer(i, { amount: e.target.value })} aria-invalid={!!row.error} />
                <button type="button" className={btnSecondary} disabled={remaining(i) <= 0}
                  onClick={() => setPayer(i, { amount: (remaining(i) / 100).toFixed(2) })} aria-label={`Fill remaining for ${label}`}>Fill remaining</button>
                <button type="button" className={btnDanger} aria-label={`Remove payer ${label}`}
                  onClick={() => setBill((b) => ({ ...b, payers: b.payers.filter((_, j) => j !== i) }))}>Remove</button>
              </div>
              <Err>{row.error}</Err>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={btnSecondary} disabled={unused.length === 0}
          onClick={() => setBill((b) => ({ ...b, payers: [...b.payers, { personId: unused[0].id, amount: '' }] }))}>Add payer</button>
        {bill.payers.length > 0 && r.total > 0 && (
          <span className="text-sm tabular-nums text-slate-700" data-testid="paid-progress">Paid {money(check.paid)} of {money(r.total)}</span>
        )}
      </div>
      <Err>{check.sumError}</Err>
      {check.ok && <p className="mt-1 text-sm text-emerald-800">Payments match the bill total.</p>}
    </section>
  )
}

function SettleUp({ bill, r, money }: { bill: Bill; r: ReturnType<typeof calculate>; money: (c: number) => string }) {
  const s = settleUp(bill, r)
  let body: React.ReactNode
  if (r.total <= 0) body = <p className="text-sm text-slate-500">Nothing to settle yet.</p>
  else if (bill.payers.length === 0) body = <p className="text-sm text-slate-500">Record who paid to see who owes whom.</p>
  else if (!s.check.ok) body = <p className="text-sm text-amber-900">Settle-up needs the payments to add up to the bill total. Fix "Who paid" first.</p>
  else if (s.transfers.length === 0) body = <p className="text-sm text-emerald-800">All square. Nobody owes anything.</p>
  else body = (
    <ul className="space-y-2">
      {s.transfers.map((t, i) => (
        <li key={i} data-testid="transfer" className="rounded-lg bg-emerald-50 px-3 py-2 text-base">{t.fromName} pays {t.toName} {money(t.cents)}</li>
      ))}
    </ul>
  )
  return (
    <section className={card} aria-labelledby="settle-h">
      <h2 id="settle-h" className="mb-3 text-lg font-semibold">Settle up</h2>
      {body}
    </section>
  )
}

function Breakdown({ bill, r, money }: { bill: Bill; r: ReturnType<typeof calculate>; money: (c: number) => string }) {
  return (
    <section className={card} aria-labelledby="bd-h">
      <h2 id="bd-h" className="mb-3 text-lg font-semibold">Breakdown</h2>
      {r.people.length === 0 ? (
        <p className="text-sm text-slate-500">Add people and items to see the split.</p>
      ) : (
        <div className="space-y-3">
          {r.people.map((p) => (
            <div key={p.id} data-testid="breakdown-row" className="rounded-lg border border-slate-200 p-3">
              <div className="flex justify-between gap-2 text-base font-semibold"><span className="truncate">{p.name}</span><span className="tabular-nums" data-testid="person-total">{money(p.total)}</span></div>
              <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 text-sm text-slate-600 tabular-nums">
                <dt>Items</dt><dd className="text-right">{money(p.subtotal)}</dd>
                <dt>Tax</dt><dd className="text-right">{money(p.tax)}</dd>
                <dt>Tip</dt><dd className="text-right">{money(p.tip)}</dd>
              </dl>
            </div>
          ))}
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-sm tabular-nums">
            <dt>Subtotal</dt><dd className="text-right" data-testid="bill-subtotal">{money(r.subtotal)}</dd>
            <dt>Tax</dt><dd className="text-right" data-testid="bill-tax">{money(r.tax)}</dd>
            <dt>Tip</dt><dd className="text-right" data-testid="bill-tip">{money(r.tip)}</dd>
            <dt className="text-base font-bold">Bill total</dt><dd className="text-right text-base font-bold" data-testid="bill-total">{money(r.total)}</dd>
          </dl>
          <span className="sr-only">{bill.currency}</span>
        </div>
      )}
    </section>
  )
}

function Actions({ summary, onReset }: { bill: Bill; summary: () => string; onReset: () => void }) {
  const [status, setStatus] = useState('')
  const [confirming, setConfirming] = useState(false)

  async function copy() {
    const text = summary()
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Summary copied to clipboard.')
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      setStatus(ok ? 'Summary copied to clipboard.' : 'Could not copy. Your browser blocked clipboard access.')
    }
    setTimeout(() => setStatus(''), 3000)
  }

  return (
    <section className={card} aria-label="Actions">
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} onClick={copy}>Copy summary</button>
        {!confirming && <button className={btnDanger} onClick={() => setConfirming(true)}>Reset</button>}
      </div>
      <p role="status" className="mt-2 min-h-5 text-sm text-emerald-800">{status}</p>
      {confirming && (
        <div role="alertdialog" aria-labelledby="reset-q" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <p id="reset-q" className="text-sm font-medium text-red-900">Reset the whole bill? All people, items, tax and tip will be cleared.</p>
          <div className="mt-2 flex gap-2">
            <button className={`${btn} bg-red-700 text-white hover:bg-red-800`} onClick={() => { onReset(); setConfirming(false) }}>Yes, reset</button>
            <button className={btnSecondary} onClick={() => setConfirming(false)} autoFocus>Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}
