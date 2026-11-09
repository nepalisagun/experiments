import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  addCard,
  type Board,
  type Card,
  COLUMNS,
  type ColumnId,
  deleteCard,
  type Filter,
  findCard,
  isFilterActive,
  isOverdue,
  isOverWip,
  isPriority,
  matchesFilter,
  moveCard,
  moveCardToAdjacentColumn,
  moveCardWithinColumn,
  PRIORITIES,
  PRIORITY_LABEL,
  todayString,
  updateCard,
  WIP_LIMIT,
} from './board'
import { BoardNameDialog, MoveToBoardDialog } from './BoardDialogs'
import { CardDialog, ConfirmDialog } from './CardDialog'
import { CardMenu } from './CardMenu'
import { type DragState, useDragAndDrop } from './useDragAndDrop'
import {
  activeBoard,
  canDeleteBoard,
  countCards,
  createBoard,
  deleteBoard,
  loadWorkspace,
  moveCardToBoard,
  renameBoard,
  saveWorkspace,
  switchBoard,
  updateBoardColumns,
  WORKSPACE_KEY,
  type Workspace,
} from './workspace'

type Editing = { kind: 'add'; column: ColumnId } | { kind: 'edit'; card: Card } | null
type BoardDialog = { kind: 'create' } | { kind: 'rename' } | { kind: 'delete' } | null

const columnTitle = (id: ColumnId) => COLUMNS.find((c) => c.id === id)!.title

function formatDue(due: string) {
  const [y, m, d] = due.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => loadWorkspace(localStorage))
  const current = activeBoard(workspace)
  const board = current.columns
  /** Updates the active board's columns. */
  const setBoard = (next: Board | ((b: Board) => Board)) =>
    setWorkspace((ws) => updateBoardColumns(ws, ws.activeBoardId, typeof next === 'function' ? next : () => next))
  const [saveFailed, setSaveFailed] = useState(false)
  const [filter, setFilter] = useState<Filter>({ query: '', priority: 'all' })
  const [editing, setEditing] = useState<Editing>(null)
  const [confirmDelete, setConfirmDelete] = useState<Card | null>(null)
  const [boardDialog, setBoardDialog] = useState<BoardDialog>(null)
  const [movingCard, setMovingCard] = useState<{ card: Card; column: ColumnId } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [today, setToday] = useState(todayString)
  const focusAfter = useRef<{ id: string; action?: string } | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => setSaveFailed(!saveWorkspace(localStorage, workspace)), [workspace])
  useEffect(() => {
    document.title = `${current.name} · My Kanban`
  }, [current.name])

  // Keep other open tabs in sync, and roll "today" over at midnight.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === WORKSPACE_KEY && setWorkspace(loadWorkspace(localStorage))
    window.addEventListener('storage', onStorage)
    const t = setInterval(() => setToday(todayString()), 60_000)
    return () => {
      window.removeEventListener('storage', onStorage)
      clearInterval(t)
    }
  }, [])

  // After a keyboard move, keep focus on the moved card (its re-mounted DOM node).
  useLayoutEffect(() => {
    const f = focusAfter.current
    if (!f) return
    focusAfter.current = null
    const li = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(f.id)}"]`)
    const btn = f.action ? li?.querySelector<HTMLElement>(`[data-action="${f.action}"]`) : null
    ;(btn ?? li)?.focus()
    li?.scrollIntoView({ block: 'nearest' })
  }, [board])

  const announceMove = (next: Board, id: string) => {
    const f = findCard(next, id)
    if (f) setAnnouncement(`“${f.card.title}” moved to ${columnTitle(f.column)}, position ${f.index + 1} of ${next[f.column].length}.`)
  }

  const { drag, onPointerDown } = useDragAndDrop((id, column, beforeId) => {
    setBoard((b) => {
      const next = moveCard(b, id, column, beforeId)
      if (next !== b) announceMove(next, id)
      return next
    })
  })

  const keyboardMove = (id: string, next: Board, action?: string) => {
    if (next === board) return
    focusAfter.current = { id, action }
    setBoard(next)
    announceMove(next, id)
  }

  const visible = useMemo(() => {
    const out = {} as Record<ColumnId, Card[]>
    for (const { id } of COLUMNS) out[id] = board[id].filter((c) => matchesFilter(c, filter))
    return out
  }, [board, filter])

  const filtering = isFilterActive(filter)
  const totalCards = COLUMNS.reduce((n, c) => n + board[c.id].length, 0)
  const totalVisible = COLUMNS.reduce((n, c) => n + visible[c.id].length, 0)
  const overWip = isOverWip(board)
  const draggedCard = drag ? findCard(board, drag.cardId)?.card : undefined

  const openEditor = (e: Editing) => {
    returnFocus.current = document.activeElement as HTMLElement | null
    setEditing(e)
  }
  const closeDialogs = (fallback?: string) => {
    setEditing(null)
    setConfirmDelete(null)
    setBoardDialog(null)
    setMovingCard(null)
    const el = returnFocus.current
    requestAnimationFrame(() => {
      if (el?.isConnected) el.focus()
      else if (fallback) document.querySelector<HTMLElement>(fallback)?.focus()
    })
  }
  const openBoardDialog = (d: BoardDialog) => {
    returnFocus.current = document.activeElement as HTMLElement | null
    setBoardDialog(d)
  }
  const openMoveToBoard = (card: Card, column: ColumnId) => {
    returnFocus.current = document.activeElement as HTMLElement | null
    setMovingCard({ card, column })
  }
  const otherBoards = workspace.boards.length > 1
  const askDelete = (card: Card) => {
    if (!editing) returnFocus.current = document.activeElement as HTMLElement | null
    setEditing(null)
    setConfirmDelete(card)
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <h1 className="text-xl font-bold tracking-tight">My Kanban</h1>
          <BoardSwitcher
            workspace={workspace}
            onSwitch={(id) => {
              const next = switchBoard(workspace, id)
              setWorkspace(next)
              setAnnouncement(`Switched to board “${activeBoard(next).name}”.`)
            }}
            onCreate={() => openBoardDialog({ kind: 'create' })}
            onRename={() => openBoardDialog({ kind: 'rename' })}
            onDelete={() => openBoardDialog({ kind: 'delete' })}
          />
          <div className="flex w-full flex-wrap gap-2 lg:ml-auto lg:w-auto" role="search">
            <label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
              <span className="sr-only">Search cards</span>
              <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 fill-slate-400">
                <path d="M8.5 3a5.5 5.5 0 1 0 3.3 9.9l3.6 3.6 1.1-1.1-3.6-3.6A5.5 5.5 0 0 0 8.5 3Zm0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
              </svg>
              <input
                type="search"
                placeholder="Search cards"
                value={filter.query}
                onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
                className="field w-full pl-8"
              />
            </label>
            <label>
              <span className="sr-only">Filter by priority</span>
              <select
                value={filter.priority}
                onChange={(e) => {
                  const v = e.target.value
                  setFilter((f) => ({ ...f, priority: isPriority(v) ? v : 'all' }))
                }}
                className="field"
              >
                <option value="all">All priorities</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4">
        {saveFailed && (
          <p role="alert" className="mb-4 rounded-lg bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            Your browser blocked saving, so changes will be lost on reload.
          </p>
        )}
        {filtering && totalVisible === 0 && (
          <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900">
            <span>
              No cards match {filter.query.trim() ? <>“{filter.query.trim()}”</> : 'your filter'}
              {filter.priority !== 'all' && <> with {PRIORITY_LABEL[filter.priority]} priority</>}
              {totalCards === 0 && ' — the board is empty'}.
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => setFilter({ query: '', priority: 'all' })}>
              Clear filters
            </button>
          </div>
        )}
        <p id="card-help" className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="sm:hidden">Drag a card by its ⠿ handle, or use the arrow buttons on it.</span>
          <span className="hidden sm:inline">
            Drag cards to move them. Keyboard: focus a card, then Alt + ←/→ moves it between columns and Alt + ↑/↓ reorders it. Enter edits, Delete removes.
          </span>
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map(({ id: col, title }) => {
            const cards = visible[col]
            const total = board[col].length
            const wipWarn = col === 'doing' && overWip
            const isTarget = drag?.over?.column === col
            return (
              <section
                key={col}
                data-column={col}
                aria-labelledby={`col-${col}`}
                className={`flex min-h-40 flex-col rounded-xl border-2 p-3 transition-colors ${
                  wipWarn ? 'border-amber-400 bg-amber-50 dark:border-amber-500/70 dark:bg-amber-950/30' : 'border-transparent bg-slate-200/70 dark:bg-slate-900'
                } ${isTarget ? 'ring-2 ring-blue-500' : ''}`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <h2 id={`col-${col}`} className="font-semibold">
                    {title}
                  </h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                      wipWarn ? 'bg-amber-500 text-white dark:text-amber-950' : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                    }`}
                    aria-label={filtering ? `${cards.length} of ${total} cards shown` : `${total} ${total === 1 ? 'card' : 'cards'}`}
                    data-testid={`count-${col}`}
                  >
                    {filtering ? `${cards.length} / ${total}` : total}
                    {col === 'doing' && !filtering && <span className="font-normal opacity-75"> / {WIP_LIMIT}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => openEditor({ kind: 'add', column: col })}
                    className="btn btn-ghost ml-auto"
                    aria-label={`Add card to ${title}`}
                  >
                    <span aria-hidden className="text-lg leading-none">+</span>
                    <span>Add</span>
                  </button>
                </div>
                {wipWarn && (
                  <p role="status" className="mb-3 flex gap-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                    <span aria-hidden>⚠</span>
                    <span>
                      WIP limit exceeded: {total} cards in {title} (limit {WIP_LIMIT}). Finish something before starting more.
                    </span>
                  </p>
                )}
                <ul className="flex flex-1 flex-col gap-2" aria-label={`${title} cards`}>
                  {cards.map((card) => (
                    <CardItem
                      key={card.id}
                      card={card}
                      column={col}
                      overdue={isOverdue(card, col, today)}
                      drag={drag}
                      onPointerDown={onPointerDown}
                      onEdit={() => openEditor({ kind: 'edit', card })}
                      onDelete={() => askDelete(card)}
                      onMoveColumn={(dir, action) => keyboardMove(card.id, moveCardToAdjacentColumn(board, card.id, dir), action)}
                      onMoveWithin={(dir) => keyboardMove(card.id, moveCardWithinColumn(board, card.id, dir))}
                      onMoveToBoard={() => openMoveToBoard(card, col)}
                      hasOtherBoards={otherBoards}
                    />
                  ))}
                  {isTarget && drag?.over?.beforeId === null && <DropIndicator />}
                  {cards.length === 0 && !isTarget && (
                    <li className="flex flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      {total === 0 ? (
                        <>
                          <span className="font-medium">No cards yet</span>
                          <span className="text-xs">{col === 'done' ? 'Finished cards land here.' : 'Add one or drag a card here.'}</span>
                        </>
                      ) : (
                        <span>No matching cards ({total} hidden by filter)</span>
                      )}
                    </li>
                  )}
                </ul>
              </section>
            )
          })}
        </div>
      </main>

      {drag && draggedCard && (
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-50"
          style={{ width: drag.width, transform: `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px) rotate(2deg)` }}
        >
          <CardFace card={draggedCard} overdue={false} done={findCard(board, drag.cardId)?.column === 'done'} className="shadow-2xl ring-2 ring-blue-500" />
        </div>
      )}

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {editing && (
        <CardDialog
          key={editing.kind === 'edit' ? editing.card.id : editing.column}
          mode={editing}
          onClose={() => closeDialogs()}
          onDelete={editing.kind === 'edit' ? () => askDelete(editing.card) : undefined}
          onSave={(input) => {
            setBoard((b) => (editing.kind === 'add' ? addCard(b, editing.column, input) : updateCard(b, editing.card.id, input)))
            closeDialogs()
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          heading="Delete this card?"
          body={<>“{confirmDelete.title}” will be removed permanently.</>}
          onClose={() => closeDialogs()}
          onConfirm={() => {
            setBoard((b) => deleteCard(b, confirmDelete.id))
            setAnnouncement(`“${confirmDelete.title}” deleted.`)
            closeDialogs(`[data-column="${findCard(board, confirmDelete.id)?.column ?? 'todo'}"] button`)
          }}
        />
      )}
      {(boardDialog?.kind === 'create' || boardDialog?.kind === 'rename') && (
        <BoardNameDialog
          workspace={workspace}
          boardId={boardDialog.kind === 'rename' ? current.id : undefined}
          onClose={() => closeDialogs()}
          onSave={(name) => {
            if (boardDialog.kind === 'create') {
              setWorkspace((ws) => createBoard(ws, name))
              setAnnouncement(`Board “${name}” created.`)
            } else {
              setWorkspace((ws) => renameBoard(ws, ws.activeBoardId, name))
              setAnnouncement(`Board renamed to “${name}”.`)
            }
            closeDialogs()
          }}
        />
      )}
      {boardDialog?.kind === 'delete' && (
        <ConfirmDialog
          heading="Delete this board?"
          body={
            <>
              “{current.name}” and its {countCards(board)} {countCards(board) === 1 ? 'card' : 'cards'} will be removed permanently.
            </>
          }
          confirmLabel="Delete board"
          onClose={() => closeDialogs()}
          onConfirm={() => {
            const next = deleteBoard(workspace, current.id)
            setWorkspace(next)
            setAnnouncement(`Board “${current.name}” deleted. Now showing “${activeBoard(next).name}”.`)
            returnFocus.current = null
            closeDialogs('#board-select')
          }}
        />
      )}
      {movingCard && (
        <MoveToBoardDialog
          workspace={workspace}
          card={movingCard.card}
          column={movingCard.column}
          onClose={() => closeDialogs()}
          onMove={(toBoardId, column) => {
            const target = workspace.boards.find((b) => b.id === toBoardId)!
            setWorkspace((ws) => moveCardToBoard(ws, movingCard.card.id, ws.activeBoardId, toBoardId, column))
            setAnnouncement(`“${movingCard.card.title}” moved to board “${target.name}”, ${columnTitle(column)}.`)
            closeDialogs(`[data-column="${movingCard.column}"] button`)
          }}
        />
      )}
    </div>
  )
}

function BoardSwitcher({
  workspace,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: {
  workspace: Workspace
  onSwitch: (id: string) => void
  onCreate: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const deletable = canDeleteBoard(workspace)
  return (
    <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto" role="group" aria-label="Boards">
      <label htmlFor="board-select" className="sr-only">
        Current board
      </label>
      <select
        id="board-select"
        value={workspace.activeBoardId}
        onChange={(e) => onSwitch(e.target.value)}
        className="field min-w-0 flex-1 font-medium sm:w-56 sm:flex-none"
      >
        {workspace.boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} ({countCards(b.columns)})
          </option>
        ))}
      </select>
      <button type="button" className="icon-btn min-h-9 px-2" onClick={onCreate} aria-label="New board" title="New board">
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-current">
          <path d="M9.25 4h1.5v5.25H16v1.5h-5.25V16h-1.5v-5.25H4v-1.5h5.25V4Z" />
        </svg>
        <span className="hidden text-sm xl:inline">New</span>
      </button>
      <button type="button" className="icon-btn min-h-9 px-2" onClick={onRename} aria-label="Rename board" title="Rename board">
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-current">
          <path d="M13.6 2.6a2 2 0 0 1 2.8 0l1 1a2 2 0 0 1 0 2.8l-9.2 9.2-4.2 1.2 1.2-4.2 9.2-9.2Zm1.4 1.4-1 1 1 1 1-1-1-1Zm-2 2-7.4 7.4-.5 1.7 1.7-.5L14 8l-1-1Z" />
        </svg>
        <span className="hidden text-sm xl:inline">Rename</span>
      </button>
      <button
        type="button"
        className="icon-btn min-h-9 px-2 enabled:hover:bg-red-50 enabled:hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 dark:enabled:hover:bg-red-950 dark:enabled:hover:text-red-300"
        onClick={onDelete}
        disabled={!deletable}
        aria-label="Delete board"
        title={deletable ? 'Delete board' : 'You can’t delete your only board'}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-current">
          <path d="M8 2h4a1 1 0 0 1 1 1v1h4v1.5H3V4h4V3a1 1 0 0 1 1-1Zm-3.5 5h11l-.8 9.1A2 2 0 0 1 12.7 18H7.3a2 2 0 0 1-2-1.9L4.5 7Zm1.6 1.5.7 7.5c0 .3.2.5.5.5h5.4c.3 0 .5-.2.5-.5l.7-7.5H6.1Z" />
        </svg>
        <span className="hidden text-sm xl:inline">Delete</span>
      </button>
    </div>
  )
}

function DropIndicator() {
  return <li aria-hidden className="h-1 rounded-full bg-blue-500" />
}

interface CardItemProps {
  card: Card
  column: ColumnId
  overdue: boolean
  drag: DragState | null
  onPointerDown: (e: React.PointerEvent, id: string) => void
  onEdit: () => void
  onDelete: () => void
  onMoveColumn: (dir: -1 | 1, action: string) => void
  onMoveWithin: (dir: -1 | 1) => void
  onMoveToBoard: () => void
  hasOtherBoards: boolean
}

function CardItem({ card, column, overdue, drag, onPointerDown, onEdit, onDelete, onMoveColumn, onMoveWithin, onMoveToBoard, hasOtherBoards }: CardItemProps) {
  const colIdx = COLUMNS.findIndex((c) => c.id === column)
  const prev = COLUMNS[colIdx - 1]
  const next = COLUMNS[colIdx + 1]
  const isDragged = drag?.cardId === card.id
  const showIndicator = drag?.over?.column === column && drag.over.beforeId === card.id

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onEdit()
    } else if (e.key === 'Delete') {
      e.preventDefault()
      onDelete()
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      onMoveColumn(e.key === 'ArrowLeft' ? -1 : 1, '')
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      onMoveWithin(e.key === 'ArrowUp' ? -1 : 1)
    }
  }

  return (
    <>
      {showIndicator && <DropIndicator />}
      <li
        data-card-id={card.id}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={`${card.title}, ${PRIORITY_LABEL[card.priority]} priority${card.due ? `, due ${formatDue(card.due)}` : ''}${overdue ? ', overdue' : ''}`}
        aria-describedby="card-help"
        onPointerDown={(e) => {
          // Mouse/pen: drag from anywhere on the card except its buttons. Touch: only from the grip,
          // so swiping over cards still scrolls the page.
          const t = e.target as HTMLElement
          if (t.closest('button')) return
          if (e.pointerType === 'touch' && !t.closest('[data-grip]')) return
          onPointerDown(e, card.id)
        }}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) onEdit()
        }}
        className={`group cursor-grab rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 ${
          isDragged ? 'opacity-40' : ''
        }`}
      >
        <CardFace
          card={card}
          overdue={overdue}
          done={column === 'done'}
          actions={
            <div className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-2 dark:border-slate-700/60">
              {prev && (
                <button type="button" data-action="left" className="icon-btn" aria-label={`Move to ${prev.title}`} title={`Move to ${prev.title}`} onClick={() => onMoveColumn(-1, 'left')}>
                  <span aria-hidden>←</span>
                  <span className="text-xs">{prev.title}</span>
                </button>
              )}
              {next && (
                <button type="button" data-action="right" className="icon-btn" aria-label={`Move to ${next.title}`} title={`Move to ${next.title}`} onClick={() => onMoveColumn(1, 'right')}>
                  <span className="text-xs">{next.title}</span>
                  <span aria-hidden>→</span>
                </button>
              )}
              <div className="ml-auto">
                <CardMenu
                  label={`Actions for “${card.title}”`}
                  items={[
                    { label: 'Edit', onSelect: onEdit },
                    {
                      label: 'Move to board…',
                      onSelect: onMoveToBoard,
                      disabled: !hasOtherBoards,
                      hint: hasOtherBoards ? undefined : 'Create another board first',
                    },
                    { label: 'Delete', onSelect: onDelete, danger: true },
                  ]}
                />
              </div>
            </div>
          }
        />
      </li>
    </>
  )
}

function CardFace({ card, overdue, done = false, actions, className = '' }: { card: Card; overdue: boolean; done?: boolean; actions?: React.ReactNode; className?: string }) {
  return (
    <article
      className={`relative rounded-lg border bg-white p-3 pl-7 shadow-sm dark:bg-slate-800 ${
        overdue ? 'overdue border-red-400 bg-red-50 dark:border-red-500/70 dark:bg-red-950/40' : 'border-slate-200 dark:border-slate-700'
      } ${className}`}
      data-overdue={overdue || undefined}
    >
      <span
        data-grip
        aria-hidden
        title="Drag to move"
        className="absolute inset-y-0 left-0 flex w-6 touch-none items-center justify-center text-slate-400 select-none group-hover:text-slate-600 dark:text-slate-500"
      >
        <svg viewBox="0 0 8 14" className="h-4 w-2 fill-current">
          <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
        </svg>
      </span>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className={`prio-${card.priority} rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide uppercase`}>{PRIORITY_LABEL[card.priority]}</span>
        {overdue && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white uppercase">Overdue</span>}
      </div>
      <h3 className={`font-medium break-words ${done ? 'text-slate-500 line-through decoration-slate-400 dark:text-slate-400' : ''}`}>{card.title}</h3>
      {card.description && <p className="mt-1 line-clamp-3 text-sm break-words whitespace-pre-line text-slate-600 dark:text-slate-300">{card.description}</p>}
      {card.due && (
        <p className={`mt-2 flex items-center gap-1 text-xs ${overdue ? 'font-semibold text-red-700 dark:text-red-300' : 'text-slate-500 dark:text-slate-400'}`}>
          <svg aria-hidden viewBox="0 0 20 20" className="size-3.5 fill-current">
            <path d="M6 2h1.5v2h5V2H14v2h2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2V2Zm-1.5 6.5v7h11v-7h-11Z" />
          </svg>
          Due {formatDue(card.due)}
        </p>
      )}
      {actions}
    </article>
  )
}
