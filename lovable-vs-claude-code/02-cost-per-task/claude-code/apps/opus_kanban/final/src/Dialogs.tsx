import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { type CardInput, PRIORITIES, type Priority } from './board'

function Modal({ open, onClose, labelledBy, children }: {
  open: boolean
  onClose: () => void
  labelledBy: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (e.target === ref.current) onClose()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/50"
    >
      {open && <div className="p-5">{children}</div>}
    </dialog>
  )
}

export function CardDialog({ open, mode, initial, onSave, onClose }: {
  open: boolean
  mode: 'add' | 'edit'
  initial: CardInput
  onSave: (input: CardInput) => void
  onClose: () => void
}) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <CardForm key={JSON.stringify(initial) + mode} titleId={titleId} mode={mode} initial={initial} onSave={onSave} onClose={onClose} />
    </Modal>
  )
}

function CardForm({ titleId, mode, initial, onSave, onClose }: {
  titleId: string
  mode: 'add' | 'edit'
  initial: CardInput
  onSave: (input: CardInput) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const [due, setDue] = useState(initial.due)
  const [priority, setPriority] = useState<Priority>(initial.priority)
  const [error, setError] = useState('')
  const ids = useId()
  const field = 'mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) {
          setError('Title is required.')
          return
        }
        onSave({ title, description, due, priority })
      }}
    >
      <h2 id={titleId} className="text-lg font-semibold">{mode === 'add' ? 'Add card' : 'Edit card'}</h2>
      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor={`${ids}-title`} className="text-sm font-medium">Title</label>
          <input
            id={`${ids}-title`}
            autoFocus
            value={title}
            maxLength={200}
            aria-invalid={!!error}
            aria-describedby={error ? `${ids}-err` : undefined}
            onChange={(e) => {
              setTitle(e.target.value)
              if (error) setError('')
            }}
            className={field}
          />
          {error && <p id={`${ids}-err`} className="mt-1 text-sm text-red-600">{error}</p>}
        </div>
        <div>
          <label htmlFor={`${ids}-desc`} className="text-sm font-medium">Description <span className="font-normal text-slate-500">(optional)</span></label>
          <textarea id={`${ids}-desc`} rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} className={field} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor={`${ids}-due`} className="text-sm font-medium">Due date <span className="font-normal text-slate-500">(optional)</span></label>
            <input id={`${ids}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
          </div>
          <fieldset className="min-w-0">
            <legend className="text-sm font-medium">Priority</legend>
            <div className="mt-1 flex gap-1">
              {PRIORITIES.map((p) => (
                <label key={p.id} className="flex-1">
                  <input type="radio" name={`${ids}-priority`} value={p.id} checked={priority === p.id} onChange={() => setPriority(p.id)} className="peer sr-only" />
                  <span className="block cursor-pointer rounded-md border border-slate-300 px-2 py-2 text-center text-sm peer-checked:border-indigo-600 peer-checked:bg-indigo-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-300">
                    {p.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {mode === 'add' ? 'Add card' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Delete', onConfirm, onClose }: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm break-words text-slate-600">{children}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" autoFocus onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
        <button type="button" onClick={onConfirm} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">{confirmLabel}</button>
      </div>
    </Modal>
  )
}

/** Create or rename a board. `validate` returns an error message or null. */
export function BoardNameDialog({ open, mode, initial, validate, onSave, onClose }: {
  open: boolean
  mode: 'create' | 'rename'
  initial: string
  validate: (name: string) => string | null
  onSave: (name: string) => void
  onClose: () => void
}) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <BoardNameForm key={mode + initial} titleId={titleId} mode={mode} initial={initial} validate={validate} onSave={onSave} onClose={onClose} />
    </Modal>
  )
}

function BoardNameForm({ titleId, mode, initial, validate, onSave, onClose }: {
  titleId: string
  mode: 'create' | 'rename'
  initial: string
  validate: (name: string) => string | null
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState('')
  const id = useId()
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const err = validate(name)
        if (err) setError(err)
        else onSave(name)
      }}
    >
      <h2 id={titleId} className="text-lg font-semibold">{mode === 'create' ? 'New board' : 'Rename board'}</h2>
      <label htmlFor={id} className="mt-4 block text-sm font-medium">Board name</label>
      <input
        id={id}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        value={name}
        maxLength={60}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          setName(e.target.value)
          if (error) setError('')
        }}
        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
      />
      {error && <p id={`${id}-err`} className="mt-1 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
        <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {mode === 'create' ? 'Create board' : 'Save'}
        </button>
      </div>
    </form>
  )
}

export function MoveToBoardDialog({ open, cardTitle, boards, onMove, onNewBoard, onClose }: {
  open: boolean
  cardTitle: string
  boards: { id: string; name: string; count: number }[]
  onMove: (boardId: string) => void
  onNewBoard: () => void
  onClose: () => void
}) {
  const titleId = useId()
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} className="text-lg font-semibold">Move to board</h2>
      <p className="mt-1 text-sm break-words text-slate-600">
        Move “<span className="font-medium text-slate-900">{cardTitle}</span>” to another board. It keeps its column.
      </p>
      {boards.length === 0 ? (
        <div className="mt-4 rounded-md bg-slate-100 px-3 py-3 text-sm text-slate-700">
          There are no other boards yet.{' '}
          <button type="button" onClick={onNewBoard} className="font-medium text-indigo-700 hover:underline">Create a board</button>
        </div>
      ) : (
        <ul className="mt-4 max-h-72 space-y-1 overflow-y-auto">
          {boards.map((b, i) => (
            <li key={b.id}>
              <button
                type="button"
                autoFocus={i === 0}
                onClick={() => onMove(b.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5 text-left text-sm hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-600"
              >
                <span className="min-w-0 truncate font-medium">{b.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{b.count} {b.count === 1 ? 'card' : 'cards'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
      </div>
    </Modal>
  )
}
