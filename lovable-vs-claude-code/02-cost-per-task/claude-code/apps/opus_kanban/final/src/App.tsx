import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  addCard,
  type Card,
  type CardInput,
  type ColumnId,
  COLUMNS,
  deleteCard,
  type Filter,
  isFilterActive,
  isOverdue,
  isWipExceeded,
  matchesFilter,
  moveCard,
  PRIORITIES,
  type Priority,
  shiftColumn,
  shiftWithinColumn,
  todayISO,
  updateCard,
  WIP_LIMIT,
} from './board'
import { BoardNameDialog, CardDialog, ConfirmDialog, MoveToBoardDialog } from './Dialogs'
import { type DragView, useCardDrag } from './useCardDrag'
import {
  activeBoard,
  addBoard,
  canDeleteBoard,
  deleteBoard,
  loadWorkspace,
  moveCardToBoard,
  renameBoard,
  saveWorkspace,
  setActiveBoard,
  setBoardCards,
  suggestBoardName,
  validateBoardName,
  WORKSPACE_KEY,
  type Workspace,
} from './workspace'

const EMPTY_INPUT: CardInput = { title: '', description: '', due: '', priority: 'medium' }
const columnTitle = (id: ColumnId) => COLUMNS.find((c) => c.id === id)!.title

const PRIORITY_STYLE: Record<Priority, string> = {
  low: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
  medium: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  high: 'bg-rose-100 text-rose-800 ring-rose-600/20',
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

type Editing = { mode: 'add'; column: ColumnId } | { mode: 'edit'; id: string } | null

const BOARD_BTN =
  'flex-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 sm:flex-none'

type BoardDialog ={ mode: 'create'; thenMoveCardId?: string } | { mode: 'rename' } | null

export default function App() {
  const [ws, setWs] = useState<Workspace>(() => loadWorkspace())
  const [filter, setFilter] = useState<Filter>({ query: '', priority: 'all' })
  const [editing, setEditing] = useState<Editing>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [boardDialog, setBoardDialog] = useState<BoardDialog>(null)
  const [confirmDeleteBoard, setConfirmDeleteBoard] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [today, setToday] = useState(todayISO)
  const focusAfterRender = useRef<string | null>(null)

  const board = activeBoard(ws)
  const cards = board.cards
  const setCards = (next: Card[]) => setWs((w) => setBoardCards(w, board.id, next))

  // Persist on every change.
  useEffect(() => {
    saveWorkspace(ws)
  }, [ws])

  // Keep other tabs in sync, and roll "today" over at midnight.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === WORKSPACE_KEY) setWs(loadWorkspace())
    }
    const timer = setInterval(() => setToday(todayISO()), 60_000)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      clearInterval(timer)
    }
  }, [])

  // Return focus to a card after a keyboard move (it re-mounts in another column).
  useLayoutEffect(() => {
    const id = focusAfterRender.current
    if (!id) return
    focusAfterRender.current = null
    document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)?.focus()
  })

  const describePosition = useCallback((list: Card[], id: string) => {
    const card = list.find((c) => c.id === id)
    if (!card) return ''
    const col = list.filter((c) => c.column === card.column)
    return `“${card.title}” moved to ${columnTitle(card.column)}, position ${col.findIndex((c) => c.id === id) + 1} of ${col.length}.`
  }, [])

  const applyMove = (next: Card[], id: string, refocus: boolean) => {
    setCards(next)
    setAnnouncement(describePosition(next, id))
    if (refocus) focusAfterRender.current = id
  }

  const { drag, startDrag, suppressClick } = useCardDrag((id, target) => {
    applyMove(moveCard(cards, id, target.column, target.beforeId), id, false)
  })

  const filterActive = isFilterActive(filter)
  const visible = useMemo(() => cards.filter((c) => matchesFilter(c, filter)), [cards, filter])
  const wipExceeded = isWipExceeded(cards)
  const editingCard = editing?.mode === 'edit' ? cards.find((c) => c.id === editing.id) : undefined
  const deletingCard = deletingId ? cards.find((c) => c.id === deletingId) : undefined
  const draggedCard = drag ? cards.find((c) => c.id === drag.id) : undefined
  const movingCard = movingId ? cards.find((c) => c.id === movingId) : undefined

  const switchBoard = (id: string) => {
    setWs((w) => setActiveBoard(w, id))
    const name = ws.boards.find((b) => b.id === id)?.name
    if (name) setAnnouncement(`Switched to board “${name}”.`)
  }

  const handleBoardName = (name: string) => {
    if (boardDialog?.mode === 'create') {
      const moveId = boardDialog.thenMoveCardId
      const fromId = board.id
      setWs((w) => {
        const created = addBoard(w, name)
        if (!moveId || created === w) return created
        // "Move to board… → Create a board": move the card, but stay on the current board.
        return setActiveBoard(moveCardToBoard(created, moveId, fromId, created.activeBoardId), fromId)
      })
      setAnnouncement(moveId ? `Created board “${name.trim()}” and moved the card there.` : `Created board “${name.trim()}”.`)
    } else if (boardDialog?.mode === 'rename') {
      setWs((w) => renameBoard(w, board.id, name))
      setAnnouncement(`Renamed board to “${name.trim()}”.`)
    }
    setBoardDialog(null)
  }

  const handleMoveToBoard = (toId: string) => {
    if (!movingCard) return
    const to = ws.boards.find((b) => b.id === toId)
    setWs((w) => moveCardToBoard(w, movingCard.id, board.id, toId))
    setAnnouncement(`Moved “${movingCard.title}” to board “${to?.name}”.`)
    setMovingId(null)
  }

  const handleSave = (input: CardInput) => {
    if (editing?.mode === 'add') {
      const next = addCard(cards, input, editing.column)
      setCards(next)
      setAnnouncement(`Added “${input.title.trim()}” to ${columnTitle(editing.column)}.`)
    } else if (editing?.mode === 'edit') {
      setCards(updateCard(cards, editing.id, input))
      setAnnouncement(`Saved “${input.title.trim()}”.`)
    }
    setEditing(null)
  }

  const handleCardKey = (e: React.KeyboardEvent, card: Card) => {
    if (e.target !== e.currentTarget || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
    const moves: Record<string, () => Card[]> = {
      ArrowLeft: () => shiftColumn(cards, card.id, -1),
      ArrowRight: () => shiftColumn(cards, card.id, 1),
      ArrowUp: () => shiftWithinColumn(cards, card.id, -1),
      ArrowDown: () => shiftWithinColumn(cards, card.id, 1),
    }
    const fn = moves[e.key]
    if (!fn) return
    e.preventDefault()
    const next = fn()
    if (next !== cards) applyMove(next, card.id, true)
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="mr-auto text-xl font-bold tracking-tight">My Kanban</h1>
          <button
            type="button"
            onClick={() => setEditing({ mode: 'add', column: 'todo' })}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            + Add card
          </button>
          <div role="search" className="flex w-full flex-wrap gap-2 sm:w-auto">
            <label className="sr-only" htmlFor="search">Search cards</label>
            <input
              id="search"
              type="search"
              placeholder="Search title or description…"
              value={filter.query}
              onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-base sm:w-64 sm:flex-none sm:text-sm"
            />
            <label className="sr-only" htmlFor="priority-filter">Filter by priority</label>
            <select
              id="priority-filter"
              value={filter.priority}
              onChange={(e) => setFilter((f) => ({ ...f, priority: e.target.value as Filter['priority'] }))}
              className="rounded-md border border-slate-300 bg-white px-2 py-2 text-base sm:text-sm"
            >
              <option value="all">All priorities</option>
              {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        </div>
        <nav aria-label="Boards" className="border-t border-slate-100 bg-slate-50">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2">
            <label htmlFor="board-switcher" className="text-sm font-medium text-slate-600">Board</label>
            <select
              id="board-switcher"
              value={board.id}
              onChange={(e) => switchBoard(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-2 text-base font-medium sm:max-w-xs sm:text-sm"
            >
              {ws.boards.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.cards.length})</option>
              ))}
            </select>
            <div className="flex w-full gap-2 sm:w-auto">
              <button type="button" onClick={() => setBoardDialog({ mode: 'create' })} className={BOARD_BTN}>+ New board</button>
              <button type="button" onClick={() => setBoardDialog({ mode: 'rename' })} className={BOARD_BTN}>Rename</button>
              <button
                type="button"
                onClick={() => setConfirmDeleteBoard(true)}
                disabled={!canDeleteBoard(ws)}
                title={canDeleteBoard(ws) ? undefined : 'You can’t delete your only board'}
                aria-describedby={canDeleteBoard(ws) ? undefined : 'last-board-hint'}
                className={`${BOARD_BTN} text-red-700 enabled:hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400`}
              >
                Delete board
              </button>
              <span id="last-board-hint" className="sr-only">You can’t delete your only board.</span>
            </div>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4">
        <p className="mb-3 hidden text-xs text-slate-500 md:block">
          Tip: drag cards to move them, or focus a card and press <kbd className="rounded border bg-white px-1">Shift</kbd> + arrow keys.
        </p>

        {filterActive && visible.length === 0 && (
          <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm">
            <span>No cards match your search{filter.priority !== 'all' ? ' and priority filter' : ''}.</span>
            <button type="button" onClick={() => setFilter({ query: '', priority: 'all' })} className="font-medium text-indigo-700 hover:underline">
              Clear filters
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const all = cards.filter((c) => c.column === col.id)
            const shown = visible.filter((c) => c.column === col.id)
            const isDoing = col.id === 'doing'
            const warn = isDoing && wipExceeded
            const isTarget = drag?.target?.column === col.id
            return (
              <section
                key={col.id}
                data-column={col.id}
                aria-labelledby={`col-${col.id}`}
                className={`flex flex-col rounded-xl border p-3 transition-colors ${
                  warn ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-200/60'
                } ${isTarget ? 'ring-2 ring-indigo-400' : ''}`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <h2 id={`col-${col.id}`} className="font-semibold">{col.title}</h2>
                  <span
                    data-testid={`count-${col.id}`}
                    aria-label={filterActive ? `${shown.length} of ${all.length} cards shown` : `${all.length} cards`}
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${warn ? 'bg-amber-500 text-white' : 'bg-white text-slate-700'}`}
                  >
                    {filterActive ? `${shown.length}/${all.length}` : all.length}
                    {isDoing && !filterActive && <span className="font-normal"> / {WIP_LIMIT}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing({ mode: 'add', column: col.id })}
                    aria-label={`Add card to ${col.title}`}
                    className="ml-auto grid size-8 place-items-center rounded-md text-lg text-slate-600 hover:bg-white"
                  >
                    +
                  </button>
                </div>

                {warn && (
                  <p role="alert" className="mb-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
                    ⚠ Work-in-progress limit exceeded: {all.length} cards in {col.title} (limit {WIP_LIMIT}).
                  </p>
                )}

                <ol className="flex min-h-24 flex-1 flex-col gap-2" aria-label={`${col.title} cards`}>
                  {shown.map((card) => (
                    <li key={card.id} className="contents">
                      {isTarget && drag?.target?.beforeId === card.id && <DropLine />}
                      <CardItem
                        card={card}
                        overdue={isOverdue(card, today)}
                        dragging={drag?.id === card.id}
                        onPointerDown={(e) => startDrag(e, card.id)}
                        onKeyDown={(e) => handleCardKey(e, card)}
                        onEdit={() => !suppressClick.current && setEditing({ mode: 'edit', id: card.id })}
                        onDelete={() => !suppressClick.current && setDeletingId(card.id)}
                        onMoveTo={(to) => applyMove(moveCard(cards, card.id, to, null), card.id, true)}
                        onMoveToBoard={() => setMovingId(card.id)}
                      />
                    </li>
                  ))}
                  {isTarget && drag?.target?.beforeId === null && <DropLine />}
                  {shown.length === 0 && (
                    <li className="grid flex-1 place-items-center rounded-lg border-2 border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                      {all.length > 0 ? 'No matching cards' : col.id === 'todo' ? 'Nothing to do yet — add a card' : col.id === 'doing' ? 'Nothing in progress' : 'Nothing done yet'}
                    </li>
                  )}
                </ol>
              </section>
            )
          })}
        </div>
      </main>

      {drag && draggedCard && <DragGhost drag={drag} card={draggedCard} overdue={isOverdue(draggedCard, today)} />}

      <div aria-live="polite" className="sr-only">{announcement}</div>

      <CardDialog
        open={editing !== null && (editing.mode === 'add' || !!editingCard)}
        mode={editing?.mode ?? 'add'}
        initial={editingCard ?? EMPTY_INPUT}
        onSave={handleSave}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={!!deletingCard}
        title="Delete card?"
        onClose={() => setDeletingId(null)}
        onConfirm={() => {
          if (deletingCard) {
            setCards(deleteCard(cards, deletingCard.id))
            setAnnouncement(`Deleted “${deletingCard.title}”.`)
          }
          setDeletingId(null)
        }}
      >
        “<span className="font-medium text-slate-900">{deletingCard?.title}</span>” will be permanently deleted.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmDeleteBoard && canDeleteBoard(ws)}
        title="Delete board?"
        confirmLabel="Delete board"
        onClose={() => setConfirmDeleteBoard(false)}
        onConfirm={() => {
          const name = board.name
          setWs((w) => deleteBoard(w, board.id))
          setAnnouncement(`Deleted board “${name}”.`)
          setConfirmDeleteBoard(false)
        }}
      >
        The board “<span className="font-medium text-slate-900">{board.name}</span>”
        {cards.length > 0 ? ` and its ${cards.length} ${cards.length === 1 ? 'card' : 'cards'} will` : ' will'} be permanently deleted.
      </ConfirmDialog>
      <BoardNameDialog
        open={boardDialog !== null}
        mode={boardDialog?.mode ?? 'create'}
        initial={boardDialog?.mode === 'rename' ? board.name : suggestBoardName(ws)}
        validate={(name) => validateBoardName(ws, name, boardDialog?.mode === 'rename' ? board.id : undefined)}
        onSave={handleBoardName}
        onClose={() => setBoardDialog(null)}
      />
      <MoveToBoardDialog
        open={!!movingCard}
        cardTitle={movingCard?.title ?? ''}
        boards={ws.boards.filter((b) => b.id !== board.id).map((b) => ({ id: b.id, name: b.name, count: b.cards.length }))}
        onMove={handleMoveToBoard}
        onNewBoard={() => {
          setBoardDialog({ mode: 'create', thenMoveCardId: movingId ?? undefined })
          setMovingId(null)
        }}
        onClose={() => setMovingId(null)}
      />
    </div>
  )
}

function DropLine() {
  return <div aria-hidden className="h-1 shrink-0 rounded-full bg-indigo-500" data-testid="drop-indicator" />
}

function CardBody({ card, overdue }: { card: Card; overdue: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${PRIORITY_STYLE[card.priority]}`}>
          {PRIORITIES.find((p) => p.id === card.priority)!.label}
        </span>
        {overdue && <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">Overdue</span>}
      </div>
      <h3 className={`mt-1.5 font-medium break-words ${card.column === 'done' ? 'text-slate-500 line-through' : ''}`}>{card.title}</h3>
      {card.description && <p className="mt-1 text-sm whitespace-pre-line break-words text-slate-600 line-clamp-4">{card.description}</p>}
      {card.due && (
        <p className={`mt-1.5 text-xs ${overdue ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
          Due <time dateTime={card.due}>{formatDate(card.due)}</time>
        </p>
      )}
    </>
  )
}

function CardItem({ card, overdue, dragging, onPointerDown, onKeyDown, onEdit, onDelete, onMoveTo, onMoveToBoard }: {
  card: Card
  overdue: boolean
  dragging: boolean
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onEdit: () => void
  onDelete: () => void
  onMoveTo: (column: ColumnId) => void
  onMoveToBoard: () => void
}) {
  return (
    <article
      data-card-id={card.id}
      data-overdue={overdue || undefined}
      tabIndex={0}
      aria-label={`${card.title}, ${card.priority} priority${overdue ? ', overdue' : ''}`}
      aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`group relative rounded-lg border p-3 pl-8 shadow-sm select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 md:cursor-grab ${
        overdue ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
      } ${dragging ? 'opacity-40' : ''}`}
    >
      {overdue && <span aria-hidden className="absolute -inset-y-px -left-px w-1 rounded-l-lg bg-red-500" />}
      <span
        data-drag-handle
        aria-hidden
        title="Drag to move"
        className="absolute inset-y-0 left-0 flex w-7 cursor-grab touch-none items-center justify-center text-slate-400"
      >
        <svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor">
          {[3, 10, 17].flatMap((y) => [<circle key={`a${y}`} cx="3" cy={y} r="1.6" />, <circle key={`b${y}`} cx="9" cy={y} r="1.6" />])}
        </svg>
      </span>
      <CardBody card={card} overdue={overdue} />
      <div className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-2">
        <label className="sr-only" htmlFor={`move-${card.id}`}>Move “{card.title}” to column</label>
        <select
          id={`move-${card.id}`}
          value={card.column}
          onChange={(e) => onMoveTo(e.target.value as ColumnId)}
          className="mr-auto min-h-9 rounded border border-slate-200 bg-white px-1.5 text-sm text-slate-700 md:min-h-7 md:text-xs"
        >
          {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.id === card.column ? c.title : `Move to ${c.title}`}</option>)}
        </select>
        <button type="button" onClick={onEdit} aria-label={`Edit “${card.title}”`} className="min-h-9 rounded px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 md:min-h-7 md:px-2 md:text-xs">
          Edit
        </button>
        <CardMenu
          cardTitle={card.title}
          items={[
            { label: 'Move to board…', onSelect: onMoveToBoard },
            { label: 'Delete…', onSelect: onDelete, danger: true },
          ]}
        />
      </div>
    </article>
  )
}

interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
}

/** A small accessible menu button (ARIA menu pattern: arrows, Home/End, Escape, click outside). */
function CardMenu({ cardTitle, items }: { cardTitle: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    itemRefs.current[0]?.focus()
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = itemRefs.current.filter(Boolean) as HTMLButtonElement[]
    const i = els.indexOf(document.activeElement as HTMLButtonElement)
    const go = (n: number) => {
      e.preventDefault()
      els[(n + els.length) % els.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(els.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
    } else if (e.key === 'Tab') close(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`More actions for “${cardTitle}”`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className="grid min-h-9 min-w-9 place-items-center rounded text-lg leading-none text-slate-600 hover:bg-slate-100 md:min-h-7 md:min-w-7"
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`Actions for “${cardTitle}”`}
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(false)
                item.onSelect()
              }}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none ${item.danger ? 'text-red-700' : 'text-slate-800'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DragGhost({ drag, card, overdue }: { drag: DragView; card: Card; overdue: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed top-0 left-0 z-50 rotate-2 rounded-lg border p-3 pl-8 shadow-xl ${overdue ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}
      style={{ width: drag.width, transform: `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px) rotate(2deg)` }}
    >
      <CardBody card={card} overdue={overdue} />
    </div>
  )
}
