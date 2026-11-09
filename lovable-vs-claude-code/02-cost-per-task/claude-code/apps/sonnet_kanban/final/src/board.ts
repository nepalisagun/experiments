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
export const STORAGE_KEY = 'kanban-board-v1'

export type CardInput = Pick<Card, 'title' | 'description' | 'dueDate' | 'priority'>

export const emptyBoard = (): Board => ({ cards: {}, columns: { todo: [], doing: [], done: [] } })

let counter = 0
export const newId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function todayString(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function findColumn(board: Board, id: string): ColumnId | null {
  return COLUMN_IDS.find((c) => board.columns[c].includes(id)) ?? null
}

function clean(i: CardInput): CardInput {
  return { title: i.title.trim(), description: i.description.trim(), dueDate: i.dueDate, priority: i.priority }
}

export function addCard(board: Board, column: ColumnId, input: CardInput, id = newId()): Board {
  const card: Card = { id, ...clean(input) }
  return {
    cards: { ...board.cards, [id]: card },
    columns: { ...board.columns, [column]: [...board.columns[column], id] },
  }
}

export function updateCard(board: Board, id: string, input: CardInput): Board {
  if (!board.cards[id]) return board
  return { ...board, cards: { ...board.cards, [id]: { id, ...clean(input) } } }
}

export function deleteCard(board: Board, id: string): Board {
  if (!board.cards[id]) return board
  const cards = { ...board.cards }
  delete cards[id]
  const columns = { ...board.columns }
  for (const c of COLUMN_IDS) columns[c] = columns[c].filter((x) => x !== id)
  return { cards, columns }
}

/** Move a card to `to`, placed before card `beforeId` (or at the end if null/unknown). */
export function moveCard(board: Board, id: string, to: ColumnId, beforeId: string | null = null): Board {
  if (!board.cards[id] || beforeId === id) return board
  const columns = { ...board.columns }
  for (const c of COLUMN_IDS) columns[c] = columns[c].filter((x) => x !== id)
  const target = [...columns[to]]
  const idx = beforeId ? target.indexOf(beforeId) : -1
  if (idx === -1) target.push(id)
  else target.splice(idx, 0, id)
  columns[to] = target
  return { ...board, columns }
}

/** Move a card one column left (-1) or right (+1), appending to the end. */
export function moveCardByStep(board: Board, id: string, step: -1 | 1): Board {
  const from = findColumn(board, id)
  if (!from) return board
  const next = COLUMN_IDS[COLUMN_IDS.indexOf(from) + step]
  return next ? moveCard(board, id, next) : board
}

/** Move a card one position up (-1) or down (+1) within its column. */
export function reorderByStep(board: Board, id: string, step: -1 | 1): Board {
  const col = findColumn(board, id)
  if (!col) return board
  const list = [...board.columns[col]]
  const i = list.indexOf(id)
  const j = i + step
  if (j < 0 || j >= list.length) return board
  ;[list[i], list[j]] = [list[j], list[i]]
  return { ...board, columns: { ...board.columns, [col]: list } }
}

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

export const isFiltering = (f: Filters) => f.query.trim() !== '' || f.priority !== 'all'

export function isOverdue(card: Card, column: ColumnId, today = todayString()): boolean {
  return column !== 'done' && card.dueDate !== '' && card.dueDate < today
}

export const wipExceeded = (board: Board) => board.columns.doing.length > WIP_LIMIT

const isPriority = (p: unknown): p is Priority => p === 'low' || p === 'medium' || p === 'high'

/** Parse untrusted stored data into a valid board (drops anything malformed). */
export function parseBoard(raw: string | null): Board {
  if (!raw) return emptyBoard()
  try {
    return sanitizeBoard(JSON.parse(raw))
  } catch {
    return emptyBoard()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeBoard(data: any): Board {
  try {
    const board = emptyBoard()
    const seen = new Set<string>()
    for (const c of COLUMN_IDS) {
      const ids = data?.columns?.[c]
      if (!Array.isArray(ids)) continue
      for (const id of ids) {
        const card = typeof id === 'string' ? data.cards?.[id] : null
        if (typeof id !== 'string' || seen.has(id) || !card || typeof card.title !== 'string') continue
        seen.add(id)
        board.cards[id] = {
          id,
          title: card.title,
          description: typeof card.description === 'string' ? card.description : '',
          dueDate: typeof card.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(card.dueDate) ? card.dueDate : '',
          priority: isPriority(card.priority) ? card.priority : 'medium',
        }
        board.columns[c].push(id)
      }
    }
    return board
  } catch {
    return emptyBoard()
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function loadBoard(storage: StorageLike | undefined = safeStorage()): Board {
  try {
    return parseBoard(storage?.getItem(STORAGE_KEY) ?? null)
  } catch {
    return emptyBoard()
  }
}

export function saveBoard(board: Board, storage: StorageLike | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(board))
  } catch {
    /* quota or privacy mode: ignore */
  }
}
