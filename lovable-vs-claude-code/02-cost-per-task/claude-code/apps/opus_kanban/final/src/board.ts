export type ColumnId = 'todo' | 'doing' | 'done'
export type Priority = 'low' | 'medium' | 'high'

export interface Card {
  id: string
  title: string
  description: string
  /** ISO date `YYYY-MM-DD`, or empty string when there is no due date. */
  due: string
  priority: Priority
  column: ColumnId
}

export type CardInput = Pick<Card, 'title' | 'description' | 'due' | 'priority'>

export const COLUMNS: { id: ColumnId; title: string }[] = [
  { id: 'todo', title: 'To do' },
  // Internal id stays 'doing' so boards already saved in localStorage keep loading.
  { id: 'doing', title: 'In progress' },
  { id: 'done', title: 'Done' },
]

export const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
]

export const WIP_LIMIT = 3
export const STORAGE_KEY = 'kanban-board-v1'

const COLUMN_IDS = COLUMNS.map((c) => c.id)
const PRIORITY_IDS = PRIORITIES.map((p) => p.id)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Local calendar date as `YYYY-MM-DD` (not UTC, so "today" matches the user's clock). */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function cardsIn(cards: Card[], column: ColumnId): Card[] {
  return cards.filter((c) => c.column === column)
}

export function addCard(cards: Card[], input: CardInput, column: ColumnId = 'todo', id: string = newId()): Card[] {
  const card: Card = { id, column, ...normalizeInput(input) }
  return [...cards, card]
}

export function updateCard(cards: Card[], id: string, input: CardInput): Card[] {
  return cards.map((c) => (c.id === id ? { ...c, ...normalizeInput(input) } : c))
}

export function deleteCard(cards: Card[], id: string): Card[] {
  return cards.filter((c) => c.id !== id)
}

function normalizeInput(input: CardInput): CardInput {
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    due: DATE_RE.test(input.due) ? input.due : '',
    priority: PRIORITY_IDS.includes(input.priority) ? input.priority : 'medium',
  }
}

/**
 * Move a card to `toColumn`, placing it immediately before the card `beforeId`
 * (or at the end of the column when `beforeId` is null). Using a neighbour id
 * instead of an index keeps drops correct while the board is filtered.
 */
export function moveCard(cards: Card[], id: string, toColumn: ColumnId, beforeId: string | null): Card[] {
  const card = cards.find((c) => c.id === id)
  if (!card || beforeId === id) return cards
  const rest = cards.filter((c) => c.id !== id)
  const moved = { ...card, column: toColumn }
  let insertAt: number
  const before = beforeId ? rest.findIndex((c) => c.id === beforeId && c.column === toColumn) : -1
  if (before >= 0) {
    insertAt = before
  } else {
    // After the last card of the target column (or at the end of the list).
    let last = -1
    rest.forEach((c, i) => {
      if (c.column === toColumn) last = i
    })
    insertAt = last >= 0 ? last + 1 : rest.length
  }
  return [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)]
}

/** Move a card one column left (-1) or right (+1), appending it to the end. */
export function shiftColumn(cards: Card[], id: string, dir: -1 | 1): Card[] {
  const card = cards.find((c) => c.id === id)
  if (!card) return cards
  const idx = COLUMN_IDS.indexOf(card.column) + dir
  if (idx < 0 || idx >= COLUMN_IDS.length) return cards
  return moveCard(cards, id, COLUMN_IDS[idx], null)
}

/** Move a card one position up (-1) or down (+1) within its column. */
export function shiftWithinColumn(cards: Card[], id: string, dir: -1 | 1): Card[] {
  const card = cards.find((c) => c.id === id)
  if (!card) return cards
  const col = cardsIn(cards, card.column)
  const pos = col.findIndex((c) => c.id === id)
  const target = pos + dir
  if (target < 0 || target >= col.length) return cards
  // Moving down by one = insert before the card two positions later.
  const beforeId = dir === -1 ? col[target].id : (col[target + 1]?.id ?? null)
  return moveCard(cards, id, card.column, beforeId)
}

export function isOverdue(card: Card, today: string = todayISO()): boolean {
  return card.column !== 'done' && card.due !== '' && card.due < today
}

export function isWipExceeded(cards: Card[]): boolean {
  return cardsIn(cards, 'doing').length > WIP_LIMIT
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

export function isFilterActive(filter: Filter): boolean {
  return filter.query.trim() !== '' || filter.priority !== 'all'
}

/** Parse stored JSON defensively: drop anything that is not a valid card. */
export function parseBoard(raw: string | null): Card[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const list = Array.isArray(data) ? data : (data as { cards?: unknown })?.cards
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: Card[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    if (typeof c.id !== 'string' || seen.has(c.id)) continue
    if (typeof c.title !== 'string' || !c.title.trim()) continue
    if (!COLUMN_IDS.includes(c.column as ColumnId)) continue
    seen.add(c.id)
    out.push({
      id: c.id,
      title: c.title,
      description: typeof c.description === 'string' ? c.description : '',
      due: typeof c.due === 'string' && DATE_RE.test(c.due) ? c.due : '',
      priority: PRIORITY_IDS.includes(c.priority as Priority) ? (c.priority as Priority) : 'medium',
      column: c.column as ColumnId,
    })
  }
  return out
}

export function serializeBoard(cards: Card[]): string {
  return JSON.stringify({ version: 1, cards })
}

export function loadBoard(storage: Pick<Storage, 'getItem'> = localStorage): Card[] {
  try {
    return parseBoard(storage.getItem(STORAGE_KEY))
  } catch {
    return []
  }
}

export function saveBoard(cards: Card[], storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    storage.setItem(STORAGE_KEY, serializeBoard(cards))
    return true
  } catch {
    return false
  }
}
