export type ColumnId = 'todo' | 'doing' | 'done'
export type Priority = 'low' | 'medium' | 'high'

export interface Card {
  id: string
  title: string
  description: string
  dueDate: string // YYYY-MM-DD or ''
  priority: Priority
}

export interface Board {
  cards: Record<string, Card>
  columns: Record<ColumnId, string[]>
}

export const COLUMN_IDS: ColumnId[] = ['todo', 'doing', 'done']
export const COLUMN_TITLES: Record<ColumnId, string> = { todo: 'To do', doing: 'In progress', done: 'Done' }
export const PRIORITIES: Priority[] = ['low', 'medium', 'high']
export const PRIORITY_LABELS: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' }
export const WIP_LIMIT = 3
export const STORAGE_KEY = 'kanban.board.v1'

export const emptyBoard = (): Board => ({ cards: {}, columns: { todo: [], doing: [], done: [] } })

export interface CardInput {
  title: string
  description?: string
  dueDate?: string
  priority: Priority
}

let counter = 0
export const newId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `c${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`)

export function addCard(board: Board, input: CardInput, column: ColumnId = 'todo', id = newId()): Board {
  const card: Card = {
    id,
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    dueDate: input.dueDate ?? '',
    priority: input.priority,
  }
  return {
    cards: { ...board.cards, [id]: card },
    columns: { ...board.columns, [column]: [...board.columns[column], id] },
  }
}

export function updateCard(board: Board, id: string, input: CardInput): Board {
  if (!board.cards[id]) return board
  return {
    ...board,
    cards: {
      ...board.cards,
      [id]: {
        id,
        title: input.title.trim(),
        description: (input.description ?? '').trim(),
        dueDate: input.dueDate ?? '',
        priority: input.priority,
      },
    },
  }
}

export function deleteCard(board: Board, id: string): Board {
  if (!board.cards[id]) return board
  const { [id]: _removed, ...cards } = board.cards
  return {
    cards,
    columns: {
      todo: board.columns.todo.filter((c) => c !== id),
      doing: board.columns.doing.filter((c) => c !== id),
      done: board.columns.done.filter((c) => c !== id),
    },
  }
}

export function findColumn(board: Board, id: string): ColumnId | undefined {
  return COLUMN_IDS.find((c) => board.columns[c].includes(id))
}

/** Move a card to `toColumn` at `index` (index in the destination list after the card is removed). Omit index to append. */
export function moveCard(board: Board, id: string, toColumn: ColumnId, index?: number): Board {
  const from = findColumn(board, id)
  if (!from) return board
  const without = board.columns[from].filter((c) => c !== id)
  const dest = from === toColumn ? without : [...board.columns[toColumn]]
  const at = index === undefined ? dest.length : Math.max(0, Math.min(index, dest.length))
  const next = [...dest.slice(0, at), id, ...dest.slice(at)]
  return {
    ...board,
    columns: { ...board.columns, [from]: without, [toColumn]: next },
  }
}

/** Move one step left/right between columns, keeping the card at the end of the target. */
export function moveCardBy(board: Board, id: string, delta: -1 | 1): Board {
  const from = findColumn(board, id)
  if (!from) return board
  const target = COLUMN_IDS[COLUMN_IDS.indexOf(from) + delta]
  return target ? moveCard(board, id, target) : board
}

/** Move one step up/down inside the column. */
export function reorderCardBy(board: Board, id: string, delta: -1 | 1): Board {
  const col = findColumn(board, id)
  if (!col) return board
  const i = board.columns[col].indexOf(id)
  const j = i + delta
  if (j < 0 || j >= board.columns[col].length) return board
  return moveCard(board, id, col, j)
}

/**
 * Resolve a drop onto `overId` (a card id or a column id) into a new board.
 * Dropping on a card places the dragged card at that card's position; on a column appends.
 */
export function dropCard(board: Board, activeId: string, overId: string): Board {
  if (activeId === overId) return board
  if ((COLUMN_IDS as string[]).includes(overId)) return moveCard(board, activeId, overId as ColumnId)
  const toColumn = findColumn(board, overId)
  if (!toColumn) return board
  const fromColumn = findColumn(board, activeId)
  if (!fromColumn) return board
  // Same column: arrayMove semantics (card takes over's slot). Other column: inserted before over.
  return moveCard(board, activeId, toColumn, board.columns[toColumn].indexOf(overId))
}

export const toDateString = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function isOverdue(card: Card, column: ColumnId, today: string = toDateString(new Date())): boolean {
  return column !== 'done' && card.dueDate !== '' && card.dueDate < today
}

export const isWipExceeded = (board: Board) => board.columns.doing.length > WIP_LIMIT

export interface Filters {
  query: string
  priority: Priority | 'all'
}

export function matchesFilters(card: Card, f: Filters): boolean {
  if (f.priority !== 'all' && card.priority !== f.priority) return false
  const q = f.query.trim().toLowerCase()
  if (!q) return true
  return card.title.toLowerCase().includes(q) || card.description.toLowerCase().includes(q)
}

export const filtersActive = (f: Filters) => f.query.trim() !== '' || f.priority !== 'all'

export function visibleIds(board: Board, column: ColumnId, f: Filters): string[] {
  return board.columns[column].filter((id) => matchesFilters(board.cards[id], f))
}

export function formatDue(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// ---- persistence ----

const isDate = (v: unknown): v is string => typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v))

/** Validate unknown data into a Board; returns an empty board for anything unusable. Drops malformed cards and duplicates. */
export function parseBoard(raw: unknown): Board {
  const board = emptyBoard()
  if (!raw || typeof raw !== 'object') return board
  const r = raw as { cards?: unknown; columns?: unknown }
  if (!r.cards || typeof r.cards !== 'object' || !r.columns || typeof r.columns !== 'object') return board
  const cards = r.cards as Record<string, Partial<Card>>
  const cols = r.columns as Record<string, unknown>
  const seen = new Set<string>()
  for (const col of COLUMN_IDS) {
    const ids = cols[col]
    if (!Array.isArray(ids)) continue
    for (const id of ids) {
      if (typeof id !== 'string' || seen.has(id)) continue
      const c = cards[id]
      if (!c || typeof c.title !== 'string' || !c.title.trim()) continue
      if (!PRIORITIES.includes(c.priority as Priority)) continue
      seen.add(id)
      board.cards[id] = {
        id,
        title: c.title,
        description: typeof c.description === 'string' ? c.description : '',
        dueDate: isDate(c.dueDate) ? c.dueDate : '',
        priority: c.priority as Priority,
      }
      board.columns[col].push(id)
    }
  }
  return board
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function loadBoard(storage: StorageLike | undefined = safeStorage()): Board {
  try {
    const text = storage?.getItem(STORAGE_KEY)
    return text ? parseBoard(JSON.parse(text)) : emptyBoard()
  } catch {
    return emptyBoard()
  }
}

export function saveBoard(board: Board, storage: StorageLike | undefined = safeStorage()): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(board))
    return !!storage
  } catch {
    return false
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
