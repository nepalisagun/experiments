import { useEffect, useRef, useState } from 'react'
import { PRIORITIES, PRIORITY_LABELS, type Card, type CardInput, type Priority } from './board'

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab' || !ref.current) return
    const f = ref.current.querySelectorAll<HTMLElement>('input, textarea, select, button:not([disabled])')
    if (!f.length) return
    const first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-t-xl bg-white p-5 shadow-2xl sm:rounded-xl"
      >
        {children}
      </div>
    </div>
  )
}

const field = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm'

export function CardDialog({ card, onSave, onCancel }: { card?: Card; onSave: (i: CardInput) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(card?.title ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [dueDate, setDueDate] = useState(card?.dueDate ?? '')
  const [priority, setPriority] = useState<Priority>(card?.priority ?? 'medium')
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => titleRef.current?.focus(), [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); titleRef.current?.focus(); return }
    onSave({ title, description, dueDate, priority })
  }

  return (
    <Modal label={card ? 'Edit card' : 'Add card'} onClose={onCancel}>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <h2 className="text-lg font-semibold">{card ? 'Edit card' : 'Add card'}</h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Title
          <input ref={titleRef} className={field} value={title} maxLength={200} aria-invalid={!!error}
            onChange={(e) => { setTitle(e.target.value); setError('') }} />
          {error && <span role="alert" className="text-xs text-rose-600">{error}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Description <span className="font-normal text-slate-500">(optional)</span>
          <textarea className={field} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Due date <span className="font-normal text-slate-500">(optional)</span>
            <input type="date" className={field} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Priority
            <select className={`${field} bg-white`} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancel</button>
          <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">{card ? 'Save' : 'Add card'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function BoardNameDialog({ title, submitLabel, initial, validate, onSave, onCancel }: {
  title: string; submitLabel: string; initial: string; validate: (name: string) => string | null
  onSave: (name: string) => void; onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const err = validate(name)
    if (err) { setError(err); ref.current?.focus(); return }
    onSave(name)
  }
  return (
    <Modal label={title} onClose={onCancel}>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <h2 className="text-lg font-semibold">{title}</h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Board name
          <input ref={ref} className={field} value={name} aria-invalid={!!error}
            onChange={(e) => { setName(e.target.value); setError('') }} />
          {error && <span role="alert" className="text-xs text-rose-600">{error}</span>}
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancel</button>
          <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">{submitLabel}</button>
        </div>
      </form>
    </Modal>
  )
}

export function MoveToBoardDialog({ cardTitle, boards, onMove, onCancel }: {
  cardTitle: string; boards: { id: string; name: string }[]; onMove: (boardId: string) => void; onCancel: () => void
}) {
  const [target, setTarget] = useState(boards[0]?.id ?? '')
  const ref = useRef<HTMLSelectElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <Modal label="Move to board" onClose={onCancel}>
      <form onSubmit={(e) => { e.preventDefault(); if (target) onMove(target) }} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Move to board</h2>
        {boards.length === 0 ? (
          <p className="text-sm text-slate-600">There is no other board yet. Create another board first.</p>
        ) : (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Move “{cardTitle}” to
            <select ref={ref} className={`${field} bg-white`} value={target} onChange={(e) => setTarget(e.target.value)}>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <span className="text-xs font-normal text-slate-500">The card keeps its column.</span>
          </label>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancel</button>
          {boards.length > 0 && <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Move</button>}
        </div>
      </form>
    </Modal>
  )
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])
  return (
    <Modal label={title} onClose={onCancel}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 break-words text-sm text-slate-600">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button ref={cancelRef} onClick={onCancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Cancel</button>
        <button onClick={onConfirm} className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">{confirmLabel}</button>
      </div>
    </Modal>
  )
}
