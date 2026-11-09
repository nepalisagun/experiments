// Pure board logic: no React, no DOM. Covered by src/board.test.ts.

export const COLUMNS = [
  { id: 'todo', title: 'To do' },
  // The id stays 'doing' so boards already saved in localStorage keep loading.
  { id: 'doing', title: 'In progress' },
  { id: 'done', title: 'Done' },
] as const

export type ColumnId = (typeof COLUMNS)[number]['id']
export const PRIORITIES = ['low', 'medium', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' }

export const WIP_LIMIT = 3

export interface Card {
  id: string
  title: string
  description: string
  /** Local calendar date as YYYY-MM-DD, or '' when there is no due date. */
  due: string
  priority: Priority
}

export type Board = Record<ColumnId, Card[]>

export type CardInput = Omit<Card, 'id'>

export const emptyBoard = (): Board => ({ todo: [], doing: [], done: [] })

export const isColumnId = (v: unknown): v is ColumnId => COLUMNS.some((c) => c.id === v)
export const isPriority = (v: unknown): v is Priority => PRIORITIES.includes(v as Priority)

let counter = 0
export function newId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Trims fields; returns an error message, or null when the input is valid. */
export function normalizeInput(input: CardInput): { card: CardInput; error: string | null } {
  const card: CardInput = {
    title: input.title.trim(),
    description: input.description.trim(),
    due: input.due.trim(),
    priority: input.priority,
  }
  if (!card.title) return { card, error: 'Title is required.' }
  if (card.due && !isValidDate(card.due)) return { card, error: 'Due date is not a valid date.' }
  if (!isPriority(card.priority)) return { card, error: 'Priority must be Low, Medium or High.' }
  return { card, error: null }
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

export function findCard(board: Board, id: string): { column: ColumnId; index: number; card: Card } | null {
  for (const { id: column } of COLUMNS) {
    const index = board[column].findIndex((c) => c.id === id)
    if (index !== -1) return { column, index, card: board[column][index] }
  }
  return null
}

export function addCard(board: Board, column: ColumnId, input: CardInput, id = newId()): Board {
  return { ...board, [column]: [...board[column], { ...input, id }] }
}

export function updateCard(board: Board, id: string, input: CardInput): Board {
  const found = findCard(board, id)
  if (!found) return board
  const list = board[found.column].slice()
  list[found.index] = { ...input, id }
  return { ...board, [found.column]: list }
}

export function deleteCard(board: Board, id: string): Board {
  const found = findCard(board, id)
  if (!found) return board
  return { ...board, [found.column]: board[found.column].filter((c) => c.id !== id) }
}

/**
 * Moves a card to `toColumn`, placing it right before the card `beforeId`,
 * or at the end of the column when `beforeId` is null or not in that column.
 * Positioning by id (not index) keeps moves correct while a filter hides cards.
 */
export function moveCard(board: Board, id: string, toColumn: ColumnId, beforeId: string | null): Board {
  const found = findCard(board, id)
  if (!found || beforeId === id) return board
  const without: Board = { ...board, [found.column]: board[found.column].filter((c) => c.id !== id) }
  const target = without[toColumn].slice()
  const at = beforeId === null ? -1 : target.findIndex((c) => c.id === beforeId)
  if (at === -1) target.push(found.card)
  else target.splice(at, 0, found.card)
  const next: Board = { ...without, [toColumn]: target }
  return sameOrder(board, next) ? board : next
}

function sameOrder(a: Board, b: Board): boolean {
  return COLUMNS.every(({ id }) => a[id].length === b[id].length && a[id].every((c, i) => c.id === b[id][i].id))
}

/** Moves a card one column left (-1) or right (+1), appending it to the end. */
export function moveCardToAdjacentColumn(board: Board, id: string, direction: -1 | 1): Board {
  const found = findCard(board, id)
  if (!found) return board
  const idx = COLUMNS.findIndex((c) => c.id === found.column) + direction
  if (idx < 0 || idx >= COLUMNS.length) return board
  return moveCard(board, id, COLUMNS[idx].id, null)
}

/** Moves a card one position up (-1) or down (+1) within its column. */
export function moveCardWithinColumn(board: Board, id: string, direction: -1 | 1): Board {
  const found = findCard(board, id)
  if (!found) return board
  const list = board[found.column]
  const to = found.index + direction
  if (to < 0 || to >= list.length) return board
  const next = list.slice()
  ;[next[found.index], next[to]] = [next[to], next[found.index]]
  return { ...board, [found.column]: next }
}

export interface Filter {
  query: string
  priority: Priority | 'all'
}

export function matchesFilter(card: Card, filter: Filter): boolean {
  if (filter.priority !== 'all' && card.priority !== filter.priority) return false
  const q = filter.query.trim().toLowerCase()
  if (!q) return true
  return card.title.toLowerCase().includes(q) || card.description.toLowerCase().includes(q)
}

export const isFilterActive = (f: Filter) => f.query.trim() !== '' || f.priority !== 'all'

/** Today's local calendar date as YYYY-MM-DD. */
export function todayString(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export function isOverdue(card: Card, column: ColumnId, today: string): boolean {
  return column !== 'done' && card.due !== '' && card.due < today
}

export const isOverWip = (board: Board) => board.doing.length > WIP_LIMIT

// ---------- persistence ----------

export const STORAGE_KEY = 'personal-kanban.board.v1'

/** Parses stored JSON defensively; anything malformed is dropped rather than crashing the app. */
export function parseBoard(raw: string | null): Board | null {
  if (raw == null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const board = emptyBoard()
  const seen = new Set<string>()
  for (const { id: column } of COLUMNS) {
    const list = (data as Record<string, unknown>)[column]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const card = toCard(item)
      if (card && !seen.has(card.id)) {
        seen.add(card.id)
        board[column].push(card)
      }
    }
  }
  return board
}

function toCard(v: unknown): Card | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id || typeof o.title !== 'string' || !o.title.trim()) return null
  return {
    id: o.id,
    title: o.title,
    description: typeof o.description === 'string' ? o.description : '',
    due: typeof o.due === 'string' && isValidDate(o.due) ? o.due : '',
    priority: isPriority(o.priority) ? o.priority : 'medium',
  }
}

export function loadBoard(storage: Pick<Storage, 'getItem'>): Board {
  try {
    return parseBoard(storage.getItem(STORAGE_KEY)) ?? emptyBoard()
  } catch {
    return emptyBoard()
  }
}

/** Returns false when storage is unavailable or full. */
export function saveBoard(storage: Pick<Storage, 'setItem'>, board: Board): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(board))
    return true
  } catch {
    return false
  }
}
