import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  COLUMN_IDS, COLUMN_TITLES, PRIORITIES, PRIORITY_LABELS, WIP_LIMIT, formatDue, isOverdue,
  type Card, type CardInput, type ColumnId, type Priority,
} from './board'

const PRIORITY_STYLE: Record<Priority, string> = {
  low: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  medium: 'bg-amber-100 text-amber-900 ring-amber-300',
  high: 'bg-red-100 text-red-800 ring-red-300',
}

export interface CardActions {
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, delta: -1 | 1) => void
  onReorder: (id: string, delta: -1 | 1) => void
  onMoveToBoard: (id: string) => void
  canMoveToBoard: boolean
}

export function PriorityLabel({ priority }: { priority: Priority }) {
  return (
    <span
      data-testid="priority-label"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${PRIORITY_STYLE[priority]}`}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  )
}

const btn =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 disabled:opacity-40 disabled:hover:bg-white min-h-8'

interface CardViewProps {
  card: Card
  column: ColumnId
  actions?: CardActions
  overlay?: boolean
}

export function CardView({ card, column, actions, overlay }: CardViewProps) {
  const overdue = isOverdue(card, column)
  const idx = COLUMN_IDS.indexOf(column)
  const left = COLUMN_IDS[idx - 1]
  const right = COLUMN_IDS[idx + 1]
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3
          data-testid="card-title"
          className={`min-w-0 break-words text-sm font-semibold ${column === 'done' ? 'text-slate-500 line-through' : 'text-slate-900'}`}
        >
          {card.title}
        </h3>
        <PriorityLabel priority={card.priority} />
      </div>
      {card.description && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{card.description}</p>
      )}
      {card.dueDate && (
        <p
          data-testid="due"
          className={`mt-2 text-xs ${overdue ? 'font-semibold text-red-700' : 'text-slate-500'}`}
        >
          {overdue && <span className="mr-1 rounded bg-red-600 px-1.5 py-0.5 text-white">Overdue</span>}
          Due {formatDue(card.dueDate)}
        </p>
      )}
      {actions && !overlay && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {left && (
            <button type="button" className={btn} onClick={() => actions.onMove(card.id, -1)} aria-label={`Move "${card.title}" to ${COLUMN_TITLES[left]}`}>
              ← {COLUMN_TITLES[left]}
            </button>
          )}
          {right && (
            <button type="button" className={btn} onClick={() => actions.onMove(card.id, 1)} aria-label={`Move "${card.title}" to ${COLUMN_TITLES[right]}`}>
              {COLUMN_TITLES[right]} →
            </button>
          )}
          <button
            type="button"
            className={btn}
            disabled={!actions.canMoveToBoard}
            title={actions.canMoveToBoard ? undefined : 'Create another board to move cards to it'}
            onClick={() => actions.onMoveToBoard(card.id)}
            aria-label={`Move "${card.title}" to another board`}
          >
            Move to board…
          </button>
          <button type="button" className={btn} onClick={() => actions.onEdit(card.id)} aria-label={`Edit "${card.title}"`}>
            Edit
          </button>
          <button type="button" className={`${btn} !text-red-700`} onClick={() => actions.onDelete(card.id)} aria-label={`Delete "${card.title}"`}>
            Delete
          </button>
        </div>
      )}
    </>
  )
}

export function SortableCard({ card, column, actions }: { card: Card; column: ColumnId; actions: CardActions }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })
  const overdue = isOverdue(card, column)

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || !e.altKey) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      actions.onMove(card.id, e.key === 'ArrowLeft' ? -1 : 1)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      actions.onReorder(card.id, e.key === 'ArrowUp' ? -1 : 1)
    }
  }

  return (
    <li
      ref={setNodeRef}
      data-testid="card"
      data-card-id={card.id}
      data-overdue={overdue}
      aria-label={`${card.title}, ${PRIORITY_LABELS[card.priority]} priority${overdue ? ', overdue' : ''}. Alt plus arrow keys moves this card.`}
      {...attributes}
      role="listitem"
      aria-roledescription="card"
      {...listeners}
      onKeyDown={onKeyDown}
      style={{ transform: CSS.Translate.toString(transform), transition, touchAction: 'manipulation' }}
      className={`cursor-grab select-none rounded-lg border bg-white p-3 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 active:cursor-grabbing ${
        overdue ? 'border-red-400 bg-red-50 border-l-4 border-l-red-600' : 'border-slate-200'
      } ${isDragging ? 'opacity-30' : ''}`}
    >
      <CardView card={card} column={column} actions={actions} />
    </li>
  )
}

interface ColumnProps {
  id: ColumnId
  total: number
  cards: Card[]
  filtering: boolean
  highlighted: boolean
  actions: CardActions
  onAdd: (c: ColumnId) => void
}

export function Column({ id, total, cards, filtering, highlighted, actions, onAdd }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id })
  const over = id === 'doing' && total > WIP_LIMIT
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      data-testid={`column-${id}`}
      className={`flex min-h-48 flex-col rounded-xl bg-slate-100 p-3 ring-2 transition-colors ${
        highlighted ? 'ring-indigo-500 bg-indigo-50' : over ? 'ring-amber-400' : 'ring-transparent'
      }`}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-bold uppercase tracking-wide text-slate-700">
          {COLUMN_TITLES[id]}
        </h2>
        <div className="flex items-center gap-2">
          <span
            data-testid="count"
            aria-label={`${filtering ? `${cards.length} of ${total}` : total} cards${id === 'doing' ? `, limit ${WIP_LIMIT}` : ''}`}
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${over ? 'bg-amber-500 text-white' : 'bg-slate-300 text-slate-800'}`}
          >
            {filtering ? `${cards.length} of ${total}` : total}
            {id === 'doing' && !filtering && ` / ${WIP_LIMIT}`}
          </span>
          <button type="button" className={btn} onClick={() => onAdd(id)} aria-label={`Add card to ${COLUMN_TITLES[id]}`}>
            + Add
          </button>
        </div>
      </header>
      {over && (
        <div role="alert" data-testid="wip-warning" className="mb-3 rounded-md border border-amber-400 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900">
          ⚠ WIP limit exceeded: {total} cards in {COLUMN_TITLES.doing}, limit is {WIP_LIMIT}. Finish something before starting more.
        </div>
      )}
      <div ref={setNodeRef} className="flex flex-1 flex-col">
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-1 flex-col gap-2" aria-label={`${COLUMN_TITLES[id]} cards`}>
            {cards.map((c) => (
              <SortableCard key={c.id} card={c} column={id} actions={actions} />
            ))}
          </ul>
        </SortableContext>
        {cards.length === 0 && (
          <p data-testid="empty" className="my-auto rounded-lg border-2 border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
            {filtering && total > 0
              ? 'No cards match the current search or filter.'
              : id === 'todo'
                ? 'Nothing to do yet. Add a card to get started.'
                : id === 'doing'
                  ? 'Nothing in progress. Drag a card here or use its move button.'
                  : 'Nothing done yet.'}
          </p>
        )}
      </div>
    </section>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input,textarea,select,button')
    first?.focus()
    return () => {
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Tab' && ref.current) {
      const f = [...ref.current.querySelectorAll<HTMLElement>('input,textarea,select,button:not([disabled])')]
      if (!f.length) return
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="max-h-full w-full overflow-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        <h2 id={titleId} className="mb-4 text-lg font-bold text-slate-900">{title}</h2>
        {children}
      </div>
    </div>
  )
}

export const field =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-indigo-600 sm:text-sm'

export function CardForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: Card
  submitLabel: string
  onSubmit: (input: CardInput) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'medium')
  const [touched, setTouched] = useState(false)
  const invalid = title.trim() === ''
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (!invalid) onSubmit({ title, description, dueDate, priority })
      }}
      className="space-y-3"
    >
      <label className="block text-sm font-medium text-slate-700">
        Title
        <input
          className={field}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={touched && invalid}
          aria-describedby={touched && invalid ? 'title-error' : undefined}
        />
        {touched && invalid && <span id="title-error" role="alert" className="mt-1 block text-sm text-red-700">Title is required.</span>}
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Description <span className="font-normal text-slate-500">(optional)</span>
        <textarea className={field} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-slate-700">
          Due date <span className="font-normal text-slate-500">(optional)</span>
          <input type="date" className={field} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Priority
          <select className={field} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
          Cancel
        </button>
        <button type="submit" className="min-h-10 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
