import { useEffect, useId, useRef, useState } from 'react'
import { type Card, COLUMNS, type ColumnId } from './board'
import { countCards, MAX_NAME_LENGTH, validateBoardName, type Workspace } from './workspace'

function useModal() {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return ref
}

const dialogClass =
  'm-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/50 dark:bg-slate-800 dark:text-slate-100'

/** Create (no `boardId`) or rename (`boardId`) a board. */
export function BoardNameDialog({
  workspace,
  boardId,
  onSave,
  onClose,
}: {
  workspace: Workspace
  boardId?: string
  onSave: (name: string) => void
  onClose: () => void
}) {
  const ref = useModal()
  const id = useId()
  const current = boardId ? workspace.boards.find((b) => b.id === boardId)?.name ?? '' : ''
  const [name, setName] = useState(current)
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = validateBoardName(workspace, name, boardId)
    if (r.error) setError(r.error)
    else onSave(r.name)
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-h`}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={dialogClass}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-5">
        <h2 id={`${id}-h`} className="text-lg font-semibold">
          {boardId ? 'Rename board' : 'New board'}
        </h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Board name
          <input
            autoFocus
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
            className="field"
          />
        </label>
        {error && (
          <p id={`${id}-err`} role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {boardId ? 'Rename' : 'Create board'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export function MoveToBoardDialog({
  workspace,
  card,
  column,
  onMove,
  onClose,
}: {
  workspace: Workspace
  card: Card
  column: ColumnId
  onMove: (boardId: string, column: ColumnId) => void
  onClose: () => void
}) {
  const ref = useModal()
  const id = useId()
  const others = workspace.boards.filter((b) => b.id !== workspace.activeBoardId)
  const [target, setTarget] = useState(others[0]?.id ?? '')
  const [targetColumn, setTargetColumn] = useState<ColumnId>(column)

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-h`}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={dialogClass}
    >
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (target) onMove(target, targetColumn)
        }}
      >
        <div>
          <h2 id={`${id}-h`} className="text-lg font-semibold">
            Move to board
          </h2>
          <p className="mt-1 text-sm break-words text-slate-600 dark:text-slate-300">“{card.title}”</p>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Board</legend>
          <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
            {others.map((b) => (
              <label
                key={b.id}
                className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 ${
                  target === b.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-300 dark:border-slate-600'
                }`}
              >
                <input type="radio" name="target-board" value={b.id} checked={target === b.id} onChange={() => setTarget(b.id)} className="accent-blue-600" />
                <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {countCards(b.columns)} {countCards(b.columns) === 1 ? 'card' : 'cards'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Column
          <select value={targetColumn} onChange={(e) => setTargetColumn(e.target.value as ColumnId)} className="field">
            {COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" autoFocus>
            Move card
          </button>
        </div>
      </form>
    </dialog>
  )
}
