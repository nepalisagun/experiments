import { useState } from 'react'
import { formatMoney, validateItem, type Currency, type Item, type ItemDraft, type ItemErrors, type Person } from '../lib/bill'

interface Props {
  items: Item[]
  people: Person[]
  currency: Currency
  onAdd: (item: Omit<Item, 'id'>) => void
  onUpdate: (id: string, item: Omit<Item, 'id'>) => void
  onRemove: (id: string) => void
}

export function Items({ items, people, currency, onAdd, onUpdate, onRemove }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '?'

  return (
    <section className="card" aria-labelledby="items-title">
      <h2 id="items-title" className="card-title">
        Items <span className="font-normal text-stone-500">({items.length})</span>
      </h2>

      <ItemForm
        idPrefix="new-item"
        people={people}
        submitLabel="Add item"
        onSubmit={(it) => {
          onAdd(it)
          return true
        }}
      />

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">No items yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-stone-100 border-t border-stone-100" aria-label="Item list">
          {items.map((it) =>
            editingId === it.id ? (
              <li key={it.id} className="py-3">
                <ItemForm
                  idPrefix={`edit-${it.id}`}
                  people={people}
                  initial={{ name: it.name, price: (it.priceCents / 100).toFixed(2), sharedBy: it.sharedBy }}
                  submitLabel="Save"
                  onCancel={() => setEditingId(null)}
                  onSubmit={(upd) => {
                    onUpdate(it.id, upd)
                    setEditingId(null)
                    return true
                  }}
                />
              </li>
            ) : (
              <li key={it.id} className="flex items-start gap-2 py-3" data-testid="item-row">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{it.name}</span>
                    <span className="shrink-0 tabular-nums">{formatMoney(it.priceCents, currency)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-stone-500">
                    {it.sharedBy.length === 1 ? 'For ' : `Shared by ${it.sharedBy.length}: `}
                    {it.sharedBy.map(nameOf).join(', ')}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <button type="button" className="btn-ghost" aria-label={`Edit ${it.name}`} onClick={() => setEditingId(it.id)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
                    aria-label={`Remove ${it.name}`}
                    onClick={() => {
                      if (editingId === it.id) setEditingId(null)
                      onRemove(it.id)
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}

function ItemForm({
  idPrefix,
  people,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  idPrefix: string
  people: Person[]
  initial?: ItemDraft
  submitLabel: string
  onSubmit: (item: Omit<Item, 'id'>) => boolean
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState<ItemDraft>(initial ?? { name: '', price: '', sharedBy: [] })
  const [errors, setErrors] = useState<ItemErrors>({})
  const set = (patch: Partial<ItemDraft>, clear: keyof ItemErrors) => {
    setDraft((d) => ({ ...d, ...patch }))
    if (errors[clear]) setErrors((e) => ({ ...e, [clear]: undefined }))
  }
  const toggle = (id: string) =>
    set({ sharedBy: draft.sharedBy.includes(id) ? draft.sharedBy.filter((x) => x !== id) : [...draft.sharedBy, id] }, 'sharedBy')
  const allSelected = people.length > 0 && people.every((p) => draft.sharedBy.includes(p.id))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const { errors: errs, priceCents } = validateItem(draft, people)
    setErrors(errs)
    if (Object.keys(errs).length > 0 || priceCents === undefined) {
      const first = (['name', 'price'] as const).find((k) => errs[k])
      if (first) document.getElementById(`${idPrefix}-${first}`)?.focus()
      return
    }
    // keep sharers in people order
    const sharedBy = people.filter((p) => draft.sharedBy.includes(p.id)).map((p) => p.id)
    if (onSubmit({ name: draft.name.trim(), priceCents, sharedBy }) && !initial) {
      setDraft({ name: '', price: '', sharedBy: [] })
      document.getElementById(`${idPrefix}-name`)?.focus()
    }
  }

  const err = (k: keyof ItemErrors) =>
    errors[k] ? (
      <p id={`${idPrefix}-${k}-error`} role="alert" className="error-text">
        {errors[k]}
      </p>
    ) : null

  return (
    <form onSubmit={submit} noValidate aria-label={initial ? 'Edit item' : 'Add item'} className="space-y-3">
      <div className="grid grid-cols-[1fr_7.5rem] gap-2">
        <div className="min-w-0">
          <label htmlFor={`${idPrefix}-name`} className="mb-1 block text-sm font-medium text-stone-700">
            Item
          </label>
          <input
            id={`${idPrefix}-name`}
            className="input"
            placeholder="e.g. Margherita pizza"
            value={draft.name}
            maxLength={80}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? `${idPrefix}-name-error` : undefined}
            onChange={(e) => set({ name: e.target.value }, 'name')}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${idPrefix}-price`} className="mb-1 block text-sm font-medium text-stone-700">
            Price
          </label>
          <input
            id={`${idPrefix}-price`}
            className="input tabular-nums"
            placeholder="0.00"
            inputMode="decimal"
            value={draft.price}
            aria-invalid={!!errors.price}
            aria-describedby={errors.price ? `${idPrefix}-price-error` : undefined}
            onChange={(e) => set({ price: e.target.value }, 'price')}
          />
        </div>
      </div>
      {err('name')}
      {err('price')}

      <fieldset aria-describedby={errors.sharedBy ? `${idPrefix}-sharedBy-error` : undefined}>
        <div className="mb-1 flex items-center justify-between">
          <legend className="text-sm font-medium text-stone-700">Shared by</legend>
          {people.length > 1 && (
            <button
              type="button"
              className="text-sm font-medium text-emerald-700 hover:underline"
              onClick={() => set({ sharedBy: allSelected ? [] : people.map((p) => p.id) }, 'sharedBy')}
            >
              {allSelected ? 'Clear' : 'Everyone'}
            </button>
          )}
        </div>
        {people.length === 0 ? (
          <p className="text-sm text-stone-500">Add people above first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {people.map((p) => {
              const on = draft.sharedBy.includes(p.id)
              return (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm select-none has-focus-visible:ring-2 has-focus-visible:ring-emerald-600/40 ${
                    on ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-stone-300 bg-white text-stone-700'
                  } ${errors.sharedBy ? 'border-red-400' : ''}`}
                >
                  <input type="checkbox" className="accent-emerald-700" checked={on} onChange={() => toggle(p.id)} />
                  <span className="max-w-[10rem] truncate">{p.name}</span>
                </label>
              )
            })}
          </div>
        )}
        {err('sharedBy')}
      </fieldset>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
