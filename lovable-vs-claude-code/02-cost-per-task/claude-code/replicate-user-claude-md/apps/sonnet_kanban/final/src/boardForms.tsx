import { useState } from 'react'
import { COLUMN_IDS, COLUMN_TITLES, type ColumnId } from './board'
import { field } from './components'

const cancelBtn =
  'min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100'
const primaryBtn = 'min-h-10 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700'

/** Name dialog for creating (blank falls back to "Board N") and renaming (blank is an error). */
export function BoardNameForm({ initial, requireName, submitLabel, onSubmit, onCancel }: {
  initial: string
  requireName: boolean
  submitLabel: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  const [touched, setTouched] = useState(false)
  const error = touched && requireName && name.trim() === ''
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (!(requireName && name.trim() === '')) onSubmit(name)
      }}
      className="space-y-3"
    >
      <label className="block text-sm font-medium text-slate-700">
        Board name
        <input
          className={field}
          value={name}
          maxLength={60}
          placeholder={requireName ? undefined : 'e.g. Work, Home, Side project'}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error}
        />
        {error && <span role="alert" className="mt-1 block text-sm text-red-700">Name is required.</span>}
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className={cancelBtn}>Cancel</button>
        <button type="submit" className={primaryBtn}>{submitLabel}</button>
      </div>
    </form>
  )
}

export function MoveToBoardForm({ boards, defaultColumn, onSubmit, onCancel }: {
  boards: { id: string; name: string }[]
  defaultColumn: ColumnId
  onSubmit: (boardId: string, column: ColumnId) => void
  onCancel: () => void
}) {
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '')
  const [column, setColumn] = useState<ColumnId>(defaultColumn)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (boardId) onSubmit(boardId, column)
      }}
      className="space-y-3"
    >
      <label className="block text-sm font-medium text-slate-700">
        Destination board
        <select className={field} value={boardId} onChange={(e) => setBoardId(e.target.value)}>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Column
        <select className={field} value={column} onChange={(e) => setColumn(e.target.value as ColumnId)}>
          {COLUMN_IDS.map((c) => <option key={c} value={c}>{COLUMN_TITLES[c]}</option>)}
        </select>
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className={cancelBtn}>Cancel</button>
        <button type="submit" className={primaryBtn}>Move card</button>
      </div>
    </form>
  )
}
