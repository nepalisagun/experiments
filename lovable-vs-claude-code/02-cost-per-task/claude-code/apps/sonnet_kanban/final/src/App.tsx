import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  COLUMN_IDS, COLUMN_TITLES, PRIORITIES, PRIORITY_LABELS, WIP_LIMIT,
  addCard, deleteCard, findColumn, isFiltering, isOverdue, matchesFilters, moveCard,
  moveCardByStep, reorderByStep, todayString, updateCard, wipExceeded,
  type Board, type Card, type CardInput, type ColumnId, type Filters, type Priority,
} from './board'
import { CardDialog, ConfirmDialog, BoardNameDialog, MoveToBoardDialog } from './dialogs'
import {
  activeBoard, addBoard, deleteBoard, loadWorkspace, moveCardToBoard, renameBoard, saveWorkspace,
  setActiveBoard, updateActiveBoard, validateBoardName, type Workspace,
} from './boards'

const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  medium: 'bg-amber-100 text-amber-900 ring-amber-300',
  high: 'bg-rose-100 text-rose-800 ring-rose-300',
}

interface DragState { id: string; x: number; y: number; dx: number; dy: number; w: number }
interface DropState { col: ColumnId; beforeId: string | null }

type DialogState =
  | { kind: 'card'; column: ColumnId; card?: Card }
  | { kind: 'delete'; card: Card }
  | { kind: 'move'; card: Card }
  | { kind: 'newBoard' }
  | { kind: 'renameBoard' }
  | { kind: 'deleteBoard' }
  | null

export default function App() {
  const [ws, setWs] = useState<Workspace>(() => loadWorkspace())
  const current = activeBoard(ws)
  const board = current.board
  const setBoard = useCallback((next: Board | ((b: Board) => Board)) => {
    setWs((w) => updateActiveBoard(w, typeof next === 'function' ? next : () => next))
  }, [])
  const [filters, setFilters] = useState<Filters>({ query: '', priority: 'all' })
  const [dialog, setDialog] = useState<DialogState>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [drop, setDrop] = useState<DropState | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const focusAfter = useRef<string | null>(null)
  const today = todayString()

  useEffect(() => saveWorkspace(ws), [ws])

  // keep keyboard focus on a card after it moved (it re-mounts in the new column)
  useLayoutEffect(() => {
    if (focusAfter.current) {
      document.querySelector<HTMLElement>(`[data-card-id="${focusAfter.current}"]`)?.focus()
      focusAfter.current = null
    }
  }, [board])

  const filtering = isFiltering(filters)
  const visible = useMemo(() => {
    const out = {} as Record<ColumnId, Card[]>
    for (const c of COLUMN_IDS) out[c] = board.columns[c].map((id) => board.cards[id]).filter((card) => matchesFilters(card, filters))
    return out
  }, [board, filters])
  const totalVisible = COLUMN_IDS.reduce((n, c) => n + visible[c].length, 0)
  const totalCards = Object.keys(board.cards).length

  const keyboardMove = (id: string, kind: 'col' | 'row', step: -1 | 1) => {
    const before = findColumn(board, id)
    const next = kind === 'col' ? moveCardByStep(board, id, step) : reorderByStep(board, id, step)
    if (next === board) return
    focusAfter.current = id
    setBoard(next)
    const after = findColumn(next, id)!
    const pos = next.columns[after].indexOf(id) + 1
    setAnnouncement(
      before !== after
        ? `Moved "${board.cards[id].title}" to ${COLUMN_TITLES[after]}, position ${pos} of ${next.columns[after].length}`
        : `Moved "${board.cards[id].title}" to position ${pos} of ${next.columns[after].length}`,
    )
  }

  // ---- pointer drag & drop (mouse + touch + pen) ----
  const dragRef = useRef<{ id: string; col: ColumnId | null; before: string | null } | null>(null)
  const pointer = useRef({ x: 0, y: 0 })

  const computeDrop = useCallback((x: number, y: number, id: string) => {
    const colEl = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-column]')
    if (!colEl) return null
    const col = colEl.dataset.column as ColumnId
    let beforeId: string | null = null
    for (const el of colEl.querySelectorAll<HTMLElement>('[data-card-id]')) {
      if (el.dataset.cardId === id) continue
      const r = el.getBoundingClientRect()
      if (y < r.top + r.height / 2) { beforeId = el.dataset.cardId!; break }
    }
    return { col, beforeId }
  }, [])

  const startPointer = (e: React.PointerEvent, card: Card) => {
    if (e.button !== 0 || !e.isPrimary) return
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, select, textarea')) return
    const isHandle = !!target.closest('[data-handle]')
    if (e.pointerType !== 'mouse' && !isHandle) return // touch scrolls the page unless the grip is used
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const startX = e.clientX, startY = e.clientY
    const dx = startX - rect.left, dy = startY - rect.top
    let active = false
    pointer.current = { x: startX, y: startY }

    const update = () => {
      const { x, y } = pointer.current
      setDrag({ id: card.id, x, y, dx, dy, w: rect.width })
      const d = computeDrop(x, y, card.id)
      dragRef.current = { id: card.id, col: d?.col ?? null, before: d?.beforeId ?? null }
      setDrop(d)
    }
    let timer = 0
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      pointer.current = { x: ev.clientX, y: ev.clientY }
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
        active = true
        document.body.classList.add('dragging')
        // auto-scroll the page while holding near the top/bottom edge
        timer = window.setInterval(() => {
          const y = pointer.current.y, h = window.innerHeight
          const speed = y < 70 ? -14 : y > h - 70 ? 14 : 0
          if (speed) { window.scrollBy(0, speed); update() }
        }, 16)
      }
      ev.preventDefault()
      update()
    }
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      cleanup()
      if (active && ev.type === 'pointerup') {
        const r = dragRef.current
        if (r && r.col) {
          const next = moveCard(board, r.id, r.col, r.before)
          if (next !== board) {
            setBoard(next)
            setAnnouncement(`Moved "${card.title}" to ${COLUMN_TITLES[r.col]}`)
          }
        }
      }
      dragRef.current = null
      setDrag(null)
      setDrop(null)
    }
    const cleanup = () => {
      window.clearInterval(timer)
      document.body.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  // ---- actions ----
  const saveCard = (column: ColumnId, existing: Card | undefined, input: CardInput) => {
    setBoard((b) => (existing ? updateCard(b, existing.id, input) : addCard(b, column, input)))
    setDialog(null)
  }
  const switchBoard = (id: string) => {
    setWs((w) => setActiveBoard(w, id))
    setAnnouncement(`Switched to board "${ws.boards.find((b) => b.id === id)?.name}"`)
  }
  const saveNewBoard = (name: string) => { setWs((w) => addBoard(w, name)); setDialog(null) }
  const saveRename = (name: string) => { setWs((w) => renameBoard(w, current.id, name)); setDialog(null) }
  const confirmDeleteBoard = () => {
    setWs((w) => deleteBoard(w, current.id))
    setAnnouncement(`Deleted board "${current.name}"`)
    setDialog(null)
  }
  const moveToBoard = (card: Card, toId: string) => {
    setWs((w) => moveCardToBoard(w, card.id, current.id, toId))
    setAnnouncement(`Moved "${card.title}" to board "${ws.boards.find((b) => b.id === toId)?.name}"`)
    setDialog(null)
  }
  const confirmDelete = (card: Card) => {
    setBoard((b) => deleteCard(b, card.id))
    setAnnouncement(`Deleted "${card.title}"`)
    setDialog(null)
  }

  const draggedCard = drag ? board.cards[drag.id] : null

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="z-20 border-b md:sticky md:top-0 border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">Kanban</h1>
            <select
              aria-label="Board"
              data-testid="board-switcher"
              value={current.id}
              onChange={(e) => switchBoard(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm font-medium sm:max-w-48 sm:flex-none"
            >
              {ws.boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <div className="flex w-full gap-2 sm:w-auto">
            <button onClick={() => setDialog({ kind: 'newBoard' })} className="rounded-md border border-slate-300 px-2 py-2 text-sm hover:bg-slate-50">New board</button>
            <button onClick={() => setDialog({ kind: 'renameBoard' })} className="rounded-md border border-slate-300 px-2 py-2 text-sm hover:bg-slate-50">Rename</button>
            <button
              onClick={() => setDialog({ kind: 'deleteBoard' })}
              disabled={ws.boards.length <= 1}
              title={ws.boards.length <= 1 ? 'The last board cannot be deleted' : undefined}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
            >
              Delete board
            </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              aria-label="Search cards"
              placeholder="Search title or description…"
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:w-64"
            />
            <select
              aria-label="Filter by priority"
              value={filters.priority}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value as Filters['priority'] })}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All priorities</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]} priority</option>)}
            </select>
            {filtering && (
              <button
                onClick={() => setFilters({ query: '', priority: 'all' })}
                className="rounded-md px-2 py-2 text-sm text-blue-700 underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4">
        <p className="mb-3 text-xs text-slate-500">
          Drag cards by the grip (or with the mouse anywhere on a card). Keyboard: focus a card, then <kbd className="rounded border bg-white px-1">Alt</kbd>+<kbd className="rounded border bg-white px-1">←</kbd>/<kbd className="rounded border bg-white px-1">→</kbd> moves it between columns, <kbd className="rounded border bg-white px-1">Alt</kbd>+<kbd className="rounded border bg-white px-1">↑</kbd>/<kbd className="rounded border bg-white px-1">↓</kbd> reorders.
        </p>

        {filtering && totalVisible === 0 && totalCards > 0 && (
          <div data-testid="no-results" className="mb-4 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600">
            <p className="font-medium">No cards match your search or filter.</p>
            <button onClick={() => setFilters({ query: '', priority: 'all' })} className="mt-2 text-blue-700 underline">Clear filters</button>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
          {COLUMN_IDS.map((col) => {
            const cards = visible[col]
            const total = board.columns[col].length
            const over = col === 'doing' && total > WIP_LIMIT
            const isDropCol = drop?.col === col
            return (
              <section
                key={col}
                data-column={col}
                aria-label={COLUMN_TITLES[col]}
                className={`rounded-xl border bg-slate-50 p-3 transition-colors ${
                  over ? 'border-amber-400 bg-amber-50' : 'border-slate-200'
                } ${isDropCol ? 'ring-2 ring-blue-400' : ''}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 font-semibold">
                    {COLUMN_TITLES[col]}
                    <span
                      data-testid={`count-${col}`}
                      aria-label={`${total} cards`}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${over ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-700'}`}
                    >
                      {filtering ? `${cards.length} of ${total}` : total}
                      {col === 'doing' ? ` / ${WIP_LIMIT}` : ''}
                    </span>
                  </h2>
                  <button
                    onClick={() => setDialog({ kind: 'card', column: col })}
                    className="rounded-md px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50"
                    aria-label={`Add card to ${COLUMN_TITLES[col]}`}
                  >
                    + Add
                  </button>
                </div>

                {col === 'doing' && wipExceeded(board) && (
                  <div role="alert" data-testid="wip-warning" className="mb-2 rounded-md border border-amber-400 bg-amber-100 px-3 py-2 text-sm text-amber-900">
                    ⚠ WIP limit exceeded: {total} cards in {COLUMN_TITLES.doing} (limit {WIP_LIMIT}). Finish something before starting more.
                  </div>
                )}

                <ul className="flex min-h-12 flex-col gap-2">
                  {cards.map((card) => (
                    <li key={card.id} className="contents">
                      {isDropCol && drop.beforeId === card.id && <DropLine />}
                      <CardView
                        card={card}
                        column={col}
                        overdue={isOverdue(card, col, today)}
                        dragging={drag?.id === card.id}
                        onPointerDown={(e) => startPointer(e, card)}
                        onEdit={() => setDialog({ kind: 'card', column: col, card })}
                        onDelete={() => setDialog({ kind: 'delete', card })}
                        onMoveToBoard={() => setDialog({ kind: 'move', card })}
                        onMove={(kind, step) => keyboardMove(card.id, kind, step)}
                      />
                    </li>
                  ))}
                  {isDropCol && drop.beforeId === null && <li className="contents"><DropLine /></li>}
                </ul>

                {cards.length === 0 && (
                  <p data-testid={`empty-${col}`} className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
                    {total === 0 ? (col === 'todo' ? 'Nothing to do yet. Add a card to get started.' : col === 'doing' ? 'Nothing in progress. Drag a card here to start.' : 'Nothing done yet.') : 'No matching cards in this column.'}
                  </p>
                )}
              </section>
            )
          })}
        </div>
      </main>

      {drag && draggedCard && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 rotate-2 rounded-lg border border-blue-400 bg-white p-3 opacity-90 shadow-xl"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}
        >
          <p className="font-medium">{draggedCard.title}</p>
        </div>
      )}

      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>

      {dialog?.kind === 'card' && (
        <CardDialog
          card={dialog.card}
          onCancel={() => setDialog(null)}
          onSave={(input) => saveCard(dialog.column, dialog.card, input)}
        />
      )}
      {dialog?.kind === 'newBoard' && (
        <BoardNameDialog title="New board" submitLabel="Create board" initial="" validate={(n) => validateBoardName(ws, n)} onCancel={() => setDialog(null)} onSave={saveNewBoard} />
      )}
      {dialog?.kind === 'renameBoard' && (
        <BoardNameDialog title="Rename board" submitLabel="Rename" initial={current.name} validate={(n) => validateBoardName(ws, n, current.id)} onCancel={() => setDialog(null)} onSave={saveRename} />
      )}
      {dialog?.kind === 'deleteBoard' && (
        <ConfirmDialog
          title="Delete this board?"
          message={`Board “${current.name}” and its ${Object.keys(board.cards).length} card(s) will be permanently deleted.`}
          confirmLabel="Delete board"
          onCancel={() => setDialog(null)}
          onConfirm={confirmDeleteBoard}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveToBoardDialog
          cardTitle={dialog.card.title}
          boards={ws.boards.filter((b) => b.id !== current.id)}
          onCancel={() => setDialog(null)}
          onMove={(id) => moveToBoard(dialog.card, id)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete this card?"
          message={`“${dialog.card.title}” will be permanently deleted.`}
          confirmLabel="Delete"
          onCancel={() => setDialog(null)}
          onConfirm={() => confirmDelete(dialog.card)}
        />
      )}
    </div>
  )
}

function DropLine() {
  return <div aria-hidden className="h-1 rounded bg-blue-500" data-testid="drop-line" />
}

interface CardViewProps {
  card: Card
  column: ColumnId
  overdue: boolean
  dragging: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onEdit: () => void
  onDelete: () => void
  onMoveToBoard: () => void
  onMove: (kind: 'col' | 'row', step: -1 | 1) => void
}

function CardView({ card, column, overdue, dragging, onPointerDown, onEdit, onDelete, onMoveToBoard, onMove }: CardViewProps) {
  const idx = COLUMN_IDS.indexOf(column)
  const prev = COLUMN_IDS[idx - 1], next = COLUMN_IDS[idx + 1]
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || !e.altKey) return
    const map: Record<string, ['col' | 'row', -1 | 1]> = {
      ArrowLeft: ['col', -1], ArrowRight: ['col', 1], ArrowUp: ['row', -1], ArrowDown: ['row', 1],
    }
    const m = map[e.key]
    if (m) { e.preventDefault(); onMove(m[0], m[1]) }
  }
  const btn = 'rounded px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100 focus-visible:outline-2'
  return (
    <article
      data-card-id={card.id}
      data-overdue={overdue || undefined}
      tabIndex={0}
      aria-label={`${card.title}, ${PRIORITY_LABELS[card.priority]} priority${overdue ? ', overdue' : ''}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`group cursor-grab select-none rounded-lg border bg-white p-3 shadow-sm focus-visible:outline-2 focus-visible:outline-blue-500 ${
        overdue ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300' : 'border-slate-200'
      } ${dragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span data-handle aria-hidden className="-ml-1 mt-0.5 cursor-grab touch-none px-1 text-lg leading-none text-slate-400" title="Drag to move">⠿</span>
        <div className="min-w-0 flex-1">
          <p data-testid="card-title" className={`break-words font-medium ${column === 'done' ? 'text-slate-500 line-through' : ''}`}>{card.title}</p>
          {card.description && <p className="mt-1 line-clamp-3 break-words text-sm text-slate-600">{card.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span data-testid="priority" className={`rounded-full px-2 py-0.5 font-medium ring-1 ${PRIORITY_STYLES[card.priority]}`}>
              {PRIORITY_LABELS[card.priority]}
            </span>
            {card.dueDate && (
              <span className={overdue ? 'font-semibold text-rose-700' : 'text-slate-500'}>
                Due {card.dueDate}
              </span>
            )}
            {overdue && <span data-testid="overdue-badge" className="rounded bg-rose-600 px-1.5 py-0.5 font-semibold text-white">Overdue</span>}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
        <div className="flex gap-1">
          {prev && <button className={btn} onClick={() => onMove('col', -1)} aria-label={`Move “${card.title}” to ${COLUMN_TITLES[prev]}`}>← {COLUMN_TITLES[prev]}</button>}
          {next && <button className={btn} onClick={() => onMove('col', 1)} aria-label={`Move “${card.title}” to ${COLUMN_TITLES[next]}`}>{COLUMN_TITLES[next]} →</button>}
        </div>
        <CardMenu title={card.title} onEdit={onEdit} onMoveToBoard={onMoveToBoard} onDelete={onDelete} />
      </div>
    </article>
  )
}

function CardMenu({ title, onEdit, onMoveToBoard, onDelete }: { title: string; onEdit: () => void; onMoveToBoard: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = [...root.current!.querySelectorAll<HTMLElement>('[role=menuitem]')]
      const i = items.indexOf(document.activeElement as HTMLElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus()
    }
    if (e.key === 'Tab') setOpen(false)
  }
  const item = 'block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 focus-visible:bg-slate-100'
  const run = (fn: () => void) => () => { setOpen(false); fn() }
  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu for “${title}”`}
        onClick={() => setOpen((o) => !o)}
        className="rounded px-2 py-1 text-base leading-none text-slate-600 hover:bg-slate-100"
      >
        ⋯
      </button>
      {open && (
        <div role="menu" aria-label={`Actions for “${title}”`} className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <button role="menuitem" className={item} onClick={run(onEdit)}>Edit</button>
          <button role="menuitem" className={item} onClick={run(onMoveToBoard)}>Move to board…</button>
          <button role="menuitem" className={`${item} text-rose-700`} onClick={run(onDelete)}>Delete</button>
        </div>
      )}
    </div>
  )
}
