import { useEffect, useState, type FormEvent } from 'react'
import { MAX_NOTE, monthLabel, monthOf, validateDraft, type Category, type DraftErrors, type Transaction, type TxDraft } from '../lib/budget.ts'
import { centsToPlain } from '../lib/money.ts'

interface Props {
  categories: Category[]
  defaultDate: string
  editing: Transaction | null
  /** Whether the transaction being edited currently repeats after its month. */
  editingRepeats: boolean
  /** Returns field errors when saving is refused, otherwise null. */
  onSubmit: (value: Omit<Transaction, 'id' | 'recurringId'>, repeat: boolean) => DraftErrors | null
  onCancel: () => void
}

const emptyDraft = (date: string, categoryId: string): TxDraft => ({ type: 'expense', amount: '', categoryId, date, note: '' })

const inputCls = (bad: boolean) =>
  `w-full rounded-lg border bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:ring-2 ${
    bad ? 'border-red-600 focus:ring-red-200' : 'border-stone-300 focus:border-stone-500 focus:ring-stone-200'
  }`

export function TransactionForm({ categories, defaultDate, editing, editingRepeats, onSubmit, onCancel }: Props) {
  const firstCat = categories[0]?.id ?? 'other'
  const [draft, setDraft] = useState<TxDraft>(() => emptyDraft(defaultDate, firstCat))
  const [repeat, setRepeat] = useState(false)
  const [errors, setErrors] = useState<DraftErrors>({})
  const editingId = editing?.id ?? null

  // Load the transaction being edited, or reset when editing ends / month changes.
  // Keyed on the id so a background save (e.g. a month being filled in) doesn't wipe what's typed.
  useEffect(() => {
    setErrors({})
    if (editing) {
      setDraft({ type: editing.type, amount: centsToPlain(editing.amountCents), categoryId: editing.categoryId, date: editing.date, note: editing.note })
      setRepeat(editingRepeats)
    } else {
      setDraft((d) => ({ ...emptyDraft(defaultDate, d.categoryId), type: d.type }))
      setRepeat(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, defaultDate])

  const partOfSeries = !!editing?.recurringId
  const repeatHint = !repeat
    ? partOfSeries && editingRepeats
      ? `Unticked: it stops repeating after ${monthLabel(monthOf(editing!.date))}.`
      : null
    : editing && partOfSeries
      ? 'Changes also apply to later months. Earlier months stay as they are.'
      : 'It will appear in every later month you open, on the same day.'

  const set = <K extends keyof TxDraft>(k: K, v: TxDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
    if (errors[k as keyof DraftErrors]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const r = validateDraft(draft, categories)
    if (!r.ok) {
      setErrors(r.errors)
      const first = (['amount', 'date', 'categoryId', 'note'] as const).find((k) => r.errors[k])
      if (first) document.getElementById(`tx-${first}`)?.focus()
      return
    }
    const refused = onSubmit(r.value, repeat)
    if (refused) {
      setErrors(refused)
      return
    }
    if (!editing) {
      setDraft((d) => ({ ...emptyDraft(d.date, d.categoryId), type: d.type }))
      setRepeat(false)
    }
  }

  const err = (k: keyof DraftErrors) =>
    errors[k] ? (
      <p id={`tx-${k}-error`} role="alert" className="mt-1 text-xs font-medium text-red-700">
        {errors[k]}
      </p>
    ) : null

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={editing ? 'Edit transaction' : 'Add transaction'}>
      <h2 className="text-base font-semibold text-stone-900">{editing ? 'Edit transaction' : 'Add transaction'}</h2>

      <fieldset>
        <legend className="sr-only">Type</legend>
        <div className="grid grid-cols-2 rounded-lg bg-stone-100 p-1 text-sm">
          {(['expense', 'income'] as const).map((t) => (
            <label
              key={t}
              className={`cursor-pointer rounded-md py-1.5 text-center font-medium capitalize has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-stone-400 ${
                draft.type === t ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'
              }`}
            >
              <input type="radio" name="type" value={t} checked={draft.type === t} onChange={() => set('type', t)} className="sr-only" />
              {t === 'expense' ? 'Expense' : 'Income'}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="tx-amount" className="mb-1 block text-xs font-medium text-stone-600">Amount</label>
          <input
            id="tx-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={draft.amount}
            onChange={(e) => set('amount', e.target.value)}
            aria-invalid={!!errors.amount}
            aria-describedby={errors.amount ? 'tx-amount-error' : undefined}
            className={`${inputCls(!!errors.amount)} tabular-nums`}
          />
          {err('amount')}
        </div>
        <div>
          <label htmlFor="tx-date" className="mb-1 block text-xs font-medium text-stone-600">Date</label>
          <input
            id="tx-date"
            type="date"
            value={draft.date}
            onChange={(e) => set('date', e.target.value)}
            aria-invalid={!!errors.date}
            aria-describedby={errors.date ? 'tx-date-error' : undefined}
            className={inputCls(!!errors.date)}
          />
          {err('date')}
        </div>
      </div>

      <div>
        <label htmlFor="tx-categoryId" className="mb-1 block text-xs font-medium text-stone-600">Category</label>
        <select
          id="tx-categoryId"
          value={draft.categoryId}
          onChange={(e) => set('categoryId', e.target.value)}
          aria-invalid={!!errors.categoryId}
          className={inputCls(!!errors.categoryId)}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {err('categoryId')}
      </div>

      <div>
        <label htmlFor="tx-note" className="mb-1 block text-xs font-medium text-stone-600">
          Note <span className="font-normal text-stone-400">(optional)</span>
        </label>
        <input
          id="tx-note"
          value={draft.note}
          maxLength={MAX_NOTE + 50}
          onChange={(e) => set('note', e.target.value)}
          placeholder="e.g. Groceries at the market"
          aria-invalid={!!errors.note}
          className={inputCls(!!errors.note)}
        />
        {err('note')}
      </div>

      <div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-800">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => setRepeat(e.target.checked)}
            aria-describedby={repeatHint ? 'tx-repeat-hint' : undefined}
            className="h-4 w-4 rounded border-stone-300 accent-stone-900"
          />
          Repeat monthly
        </label>
        {repeatHint && <p id="tx-repeat-hint" className="mt-1 pl-6 text-xs text-stone-500">{repeatHint}</p>}
      </div>

      <div className="flex gap-2">
        <button type="submit" className="flex-1 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
          {editing ? 'Save changes' : 'Add transaction'}
        </button>
        {editing && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
