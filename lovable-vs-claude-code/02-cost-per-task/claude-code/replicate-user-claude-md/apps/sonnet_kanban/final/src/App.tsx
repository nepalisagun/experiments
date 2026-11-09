import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, closestCorners, pointerWithin, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  COLUMN_IDS, COLUMN_TITLES, PRIORITIES, PRIORITY_LABELS, addCard, deleteCard, dropCard, filtersActive, findColumn,
  moveCardBy, reorderCardBy, updateCard, visibleIds, type Board, type CardInput, type ColumnId, type Filters, type Priority,
} from './board'
import {
  activeBoard, boardList, canDeleteBoard, createBoard, deleteBoard, loadWorkspace, moveCardToBoard, renameBoard,
  saveWorkspace, setActiveBoard, totalCards as countCards, updateActiveBoard, type Workspace,
} from './workspace'
import { CardForm, CardView, Column, Modal, type CardActions } from './components'
import { BoardNameForm, MoveToBoardForm } from './boardForms'

type Dialog =
  | { kind: 'add'; column: ColumnId }
  | { kind: 'edit'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'moveToBoard'; id: string }
  | { kind: 'newBoard' }
  | { kind: 'renameBoard' }
  | { kind: 'deleteBoard' }
  | null

const NO_FILTERS: Filters = { query: '', priority: 'all' }

// Prefer the column/card under the pointer; fall back to nearest corners (e.g. when released in a gap).
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const cardHits = hits.filter((h) => !(COLUMN_IDS as string[]).includes(String(h.id)))
  if (cardHits.length) return cardHits
  if (hits.length) return hits
  return closestCorners(args)
}

export default function App() {
  const [ws, setWs] = useState<Workspace>(() => loadWorkspace())
  const board = activeBoard(ws)
  const boards = boardList(ws)
  const current = ws.boards[ws.activeId]
  // Every board edit below goes through the active board.
  const setBoard = useCallback((fn: (b: Board) => Board) => setWs((w) => updateActiveBoard(w, fn)), [])
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<ColumnId | null>(null)
  const [announce, setAnnounce] = useState('')
  const focusId = useRef<string | null>(null)

  useEffect(() => { saveWorkspace(ws) }, [ws])

  // Keep keyboard focus on a card after it moves (it is re-mounted in its new column).
  useEffect(() => {
    if (!focusId.current) return
    document.querySelector<HTMLElement>(`[data-card-id="${focusId.current}"]`)?.focus()
    focusId.current = null
  }, [board])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const filtering = filtersActive(filters)
  const shown = useMemo(
    () => Object.fromEntries(COLUMN_IDS.map((c) => [c, visibleIds(board, c, filters)])) as Record<ColumnId, string[]>,
    [board, filters],
  )
  const totalShown = COLUMN_IDS.reduce((n, c) => n + shown[c].length, 0)
  const totalCards = Object.keys(board.cards).length

  const columnName = (c: ColumnId) => COLUMN_TITLES[c]

  const actions: CardActions = useMemo(() => ({
    onEdit: (id) => setDialog({ kind: 'edit', id }),
    onDelete: (id) => setDialog({ kind: 'delete', id }),
    onMove: (id, delta) => setBoard((b) => {
      const next = moveCardBy(b, id, delta)
      if (next !== b) {
        focusId.current = id
        setAnnounce(`Moved ${b.cards[id].title} to ${columnName(findColumn(next, id)!)}`)
      }
      return next
    }),
    onReorder: (id, delta) => setBoard((b) => {
      const next = reorderCardBy(b, id, delta)
      if (next !== b) {
        focusId.current = id
        const col = findColumn(next, id)!
        setAnnounce(`Moved ${b.cards[id].title} to position ${next.columns[col].indexOf(id) + 1} of ${next.columns[col].length}`)
      }
      return next
    }),
    onMoveToBoard: (id) => setDialog({ kind: 'moveToBoard', id }),
    canMoveToBoard: boards.length > 1,
  }), [setBoard, boards.length])

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id))
  const columnOf = useCallback((overId: string | number | undefined): ColumnId | null => {
    if (overId === undefined) return null
    const s = String(overId)
    return (COLUMN_IDS as string[]).includes(s) ? (s as ColumnId) : (findColumn(board, s) ?? null)
  }, [board])
  const onDragOver = (e: DragOverEvent) => setOverColumn(columnOf(e.over?.id))
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null)
    setOverColumn(null)
    if (!e.over) return
    const active = String(e.active.id)
    setBoard((b) => {
      const next = dropCard(b, active, String(e.over!.id))
      if (next !== b) setAnnounce(`Dropped ${b.cards[active].title} in ${columnName(findColumn(next, active)!)}`)
      return next
    })
  }
  const onDragCancel = () => { setDragId(null); setOverColumn(null) }

  const submit = (input: CardInput) => {
    if (dialog?.kind === 'add') setBoard((b) => addCard(b, input, dialog.column))
    else if (dialog?.kind === 'edit') setBoard((b) => updateCard(b, dialog.id, input))
    setDialog(null)
  }
  const confirmDelete = () => {
    if (dialog?.kind === 'delete') setBoard((b) => deleteCard(b, dialog.id))
    setDialog(null)
  }

  const switchBoard = (id: string) => {
    setWs((w) => setActiveBoard(w, id))
    setFilters(NO_FILTERS)
    setAnnounce(`Switched to ${ws.boards[id]?.name ?? 'board'}`)
  }
  const submitNewBoard = (name: string) => {
    setWs((w) => createBoard(w, name))
    setFilters(NO_FILTERS)
    setDialog(null)
  }
  const submitRename = (name: string) => {
    setWs((w) => renameBoard(w, w.activeId, name))
    setDialog(null)
  }
  const confirmDeleteBoard = () => {
    setWs((w) => deleteBoard(w, w.activeId))
    setFilters(NO_FILTERS)
    setDialog(null)
  }
  const submitMoveToBoard = (toId: string, column: ColumnId) => {
    if (dialog?.kind !== 'moveToBoard') return
    const cardId = dialog.id
    setAnnounce(`Moved ${board.cards[cardId]?.title ?? 'card'} to ${ws.boards[toId].name}`)
    setWs((w) => moveCardToBoard(w, w.activeId, cardId, toId, column))
    setDialog(null)
  }

  const movingCard = dialog?.kind === 'moveToBoard' ? board.cards[dialog.id] : undefined
  const editing = dialog?.kind === 'edit' ? board.cards[dialog.id] : undefined
  const deleting = dialog?.kind === 'delete' ? board.cards[dialog.id] : undefined
  const dragCard = dragId ? board.cards[dragId] : undefined

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <h1 className="text-xl font-bold">My Kanban</h1>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              aria-label="Search cards"
              placeholder="Search title or description…"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base sm:w-64 sm:text-sm"
            />
            <select
              aria-label="Filter by priority"
              value={filters.priority}
              onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as Priority | 'all' }))}
              className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm"
            >
              <option value="all">All priorities</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
            {filtering && (
              <button
                type="button"
                onClick={() => setFilters({ query: '', priority: 'all' })}
                className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-100"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setDialog({ kind: 'add', column: 'todo' })}
              className="min-h-10 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              New card
            </button>
          </div>
        </div>
      </header>

      <nav aria-label="Boards" className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pb-3">
          <label className="flex w-full min-w-0 items-center gap-2 text-sm font-medium text-slate-700 sm:w-auto">
            Board
            <select
              aria-label="Switch board"
              value={ws.activeId}
              onChange={(e) => switchBoard(e.target.value)}
              className="min-h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-base font-semibold sm:w-64 sm:flex-none sm:text-sm"
            >
              {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setDialog({ kind: 'newBoard' })} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-100">
            New board
          </button>
          <button type="button" onClick={() => setDialog({ kind: 'renameBoard' })} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-100">
            Rename
          </button>
          <button
            type="button"
            disabled={!canDeleteBoard(ws)}
            title={canDeleteBoard(ws) ? undefined : 'You can’t delete your only board'}
            onClick={() => setDialog({ kind: 'deleteBoard' })}
            className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-red-700 hover:bg-slate-100 disabled:text-slate-400 disabled:hover:bg-white"
          >
            Delete board
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-5">
        <p className="mb-3 text-xs text-slate-500">
          Drag cards to move or reorder them. Keyboard: focus a card and press Alt+←/→ to change column, Alt+↑/↓ to reorder, or use the buttons on the card.
        </p>
        {filtering && totalShown === 0 && (
          <div data-testid="no-results" role="status" className="mb-4 rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-8 text-center text-slate-600">
            <p className="font-semibold">{totalCards === 0 ? 'No cards yet.' : 'No cards match your search or filter.'}</p>
            <button type="button" onClick={() => setFilters({ query: '', priority: 'all' })} className="mt-2 text-sm font-medium text-indigo-700 underline">
              Clear search and filter
            </button>
          </div>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:items-start">
            {COLUMN_IDS.map((c) => (
              <Column
                key={c}
                id={c}
                total={board.columns[c].length}
                cards={shown[c].map((id) => board.cards[id])}
                filtering={filtering}
                highlighted={dragId !== null && overColumn === c && findColumn(board, dragId) !== c}
                actions={actions}
                onAdd={(col) => setDialog({ kind: 'add', column: col })}
              />
            ))}
          </div>
          <DragOverlay>
            {dragCard && dragId ? (
              <div className="rotate-1 cursor-grabbing rounded-lg border border-indigo-400 bg-white p-3 shadow-xl">
                <CardView card={dragCard} column={findColumn(board, dragId) ?? 'todo'} overlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </main>

      <div aria-live="polite" role="status" className="sr-only">{announce}</div>

      {dialog && (dialog.kind === 'add' || editing) && (
        <Modal title={dialog.kind === 'add' ? `Add card to ${columnName(dialog.column)}` : 'Edit card'} onClose={() => setDialog(null)}>
          <CardForm initial={editing} submitLabel={dialog.kind === 'add' ? 'Add card' : 'Save'} onSubmit={submit} onCancel={() => setDialog(null)} />
        </Modal>
      )}
      {dialog?.kind === 'newBoard' && (
        <Modal title="New board" onClose={() => setDialog(null)}>
          <BoardNameForm initial="" requireName={false} submitLabel="Create board" onSubmit={submitNewBoard} onCancel={() => setDialog(null)} />
        </Modal>
      )}
      {dialog?.kind === 'renameBoard' && (
        <Modal title="Rename board" onClose={() => setDialog(null)}>
          <BoardNameForm initial={current.name} requireName submitLabel="Save" onSubmit={submitRename} onCancel={() => setDialog(null)} />
        </Modal>
      )}
      {dialog?.kind === 'deleteBoard' && canDeleteBoard(ws) && (
        <Modal title="Delete this board?" onClose={() => setDialog(null)}>
          <p className="mb-4 text-sm text-slate-700">
            “{current.name}” and {countCards(board) === 1 ? 'its 1 card' : `its ${countCards(board)} cards`} will be permanently deleted. This can’t be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100">
              Cancel
            </button>
            <button type="button" onClick={confirmDeleteBoard} className="min-h-10 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
              Delete board
            </button>
          </div>
        </Modal>
      )}
      {movingCard && dialog?.kind === 'moveToBoard' && (
        <Modal title={`Move “${movingCard.title}” to another board`} onClose={() => setDialog(null)}>
          <MoveToBoardForm
            boards={boards.filter((b) => b.id !== ws.activeId)}
            defaultColumn={findColumn(board, dialog.id) ?? 'todo'}
            onSubmit={submitMoveToBoard}
            onCancel={() => setDialog(null)}
          />
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete this card?" onClose={() => setDialog(null)}>
          <p className="mb-4 text-sm text-slate-700">
            “{deleting.title}” will be permanently deleted. This can’t be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100">
              Cancel
            </button>
            <button type="button" onClick={confirmDelete} className="min-h-10 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
