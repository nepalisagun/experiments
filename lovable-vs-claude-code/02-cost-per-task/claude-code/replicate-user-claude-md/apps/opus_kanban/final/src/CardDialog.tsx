import { useEffect, useId, useRef, useState } from 'react'
import { type Card, type CardInput, COLUMNS, type ColumnId, normalizeInput, PRIORITIES, PRIORITY_LABEL } from './board'

interface Props {
  mode: { kind: 'add'; column: ColumnId } | { kind: 'edit'; card: Card }
  onSave: (input: CardInput) => void
  onDelete?: () => void
  onClose: () => void
}

export function CardDialog({ mode, onSave, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const initial = mode.kind === 'edit' ? mode.card : { title: '', description: '', due: '', priority: 'medium' as const }
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const [due, setDue] = useState(initial.due)
  const [priority, setPriority] = useState(initial.priority)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const { card, error } = normalizeInput({ title, description, due, priority })
    if (error) {
      setError(error)
      return
    }
    onSave(card)
  }

  const heading =
    mode.kind === 'add' ? `Add card to ${COLUMNS.find((c) => c.id === mode.column)!.title}` : 'Edit card'

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-h`}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/50 dark:bg-slate-800 dark:text-slate-100"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 p-5" noValidate>
        <h2 id={`${id}-h`} className="text-lg font-semibold">
          {heading}
        </h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Title <span className="sr-only">(required)</span>
          <input
            autoFocus
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value)
              setError(null)
            }}
            aria-invalid={error === 'Title is required.'}
            aria-describedby={error ? `${id}-err` : undefined}
            className="field"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          <span>
            Description <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
          </span>
          <textarea value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} className="field resize-y" />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span>
              Due date <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
            </span>
            <input
              type="date"
              value={due}
              onChange={(e) => {
                setDue(e.target.value)
                setError(null)
              }}
              className="field"
            />
          </label>
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1 font-medium">Priority</legend>
            <div className="flex gap-1">
              {PRIORITIES.map((p) => (
                <label
                  key={p}
                  className={`flex-1 cursor-pointer rounded-md border px-2 py-2 text-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 ${
                    priority === p ? `prio-${p} border-transparent font-semibold` : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} className="sr-only" />
                  {PRIORITY_LABEL[p]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        {error && (
          <p id={`${id}-err`} role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {onDelete && (
            <button type="button" onClick={onDelete} className="btn btn-danger mr-auto">
              Delete
            </button>
          )}
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {mode.kind === 'add' ? 'Add card' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

interface ConfirmProps {
  heading: string
  body: React.ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ heading, body, confirmLabel = 'Delete', onConfirm, onClose }: ConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={`${id}-h`}
      aria-describedby={`${id}-d`}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-900/50 dark:bg-slate-800 dark:text-slate-100"
    >
      <h2 id={`${id}-h`} className="text-lg font-semibold">
        {heading}
      </h2>
      <p id={`${id}-d`} className="mt-2 text-sm break-words text-slate-600 dark:text-slate-300">
        {body}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" autoFocus onClick={onClose} className="btn btn-secondary">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className="btn btn-danger-solid">
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
