import {
  COLUMN_IDS, STORAGE_KEY as LEGACY_STORAGE_KEY, addCard, deleteCard, emptyBoard, findColumn, newId, parseBoard,
  type Board, type ColumnId,
} from './board'

export interface NamedBoard {
  id: string
  name: string
  board: Board
}

export interface Workspace {
  boards: Record<string, NamedBoard>
  order: string[] // display order of board ids
  activeId: string
}

export const WORKSPACE_KEY = 'kanban.workspace.v1'
export const DEFAULT_BOARD_NAME = 'My board'
export const MAX_NAME = 60

const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME)

export function workspaceFrom(board: Board = emptyBoard(), name = DEFAULT_BOARD_NAME, id = newId()): Workspace {
  return { boards: { [id]: { id, name, board } }, order: [id], activeId: id }
}

export const activeBoard = (ws: Workspace): Board => ws.boards[ws.activeId].board
export const boardList = (ws: Workspace): NamedBoard[] => ws.order.map((id) => ws.boards[id])

/** Returns a unique default like "Board 2" when no name is given. */
function defaultName(ws: Workspace): string {
  const taken = new Set(boardList(ws).map((b) => b.name.toLowerCase()))
  for (let n = ws.order.length + 1; ; n++) if (!taken.has(`board ${n}`)) return `Board ${n}`
}

/** Create an empty board and make it active. A blank name falls back to "Board N". */
export function createBoard(ws: Workspace, name: string, id = newId()): Workspace {
  const finalName = cleanName(name) || defaultName(ws)
  return {
    boards: { ...ws.boards, [id]: { id, name: finalName, board: emptyBoard() } },
    order: [...ws.order, id],
    activeId: id,
  }
}

/** Blank names are rejected (returns the same workspace). */
export function renameBoard(ws: Workspace, id: string, name: string): Workspace {
  const n = cleanName(name)
  if (!n || !ws.boards[id] || ws.boards[id].name === n) return ws
  return { ...ws, boards: { ...ws.boards, [id]: { ...ws.boards[id], name: n } } }
}

export const canDeleteBoard = (ws: Workspace) => ws.order.length > 1

/** Never deletes the last board. If the active board goes, the neighbour (previous, else next) becomes active. */
export function deleteBoard(ws: Workspace, id: string): Workspace {
  if (!ws.boards[id] || !canDeleteBoard(ws)) return ws
  const i = ws.order.indexOf(id)
  const order = ws.order.filter((b) => b !== id)
  const { [id]: _gone, ...boards } = ws.boards
  const activeId = ws.activeId === id ? order[Math.max(0, i - 1)] : ws.activeId
  return { boards, order, activeId }
}

export function setActiveBoard(ws: Workspace, id: string): Workspace {
  return ws.boards[id] && ws.activeId !== id ? { ...ws, activeId: id } : ws
}

/** Apply a board transformation to the active board only. */
export function updateActiveBoard(ws: Workspace, fn: (b: Board) => Board): Workspace {
  const cur = ws.boards[ws.activeId]
  const next = fn(cur.board)
  return next === cur.board ? ws : { ...ws, boards: { ...ws.boards, [cur.id]: { ...cur, board: next } } }
}

/** Move a card from one board into a column of another (appended at the end). The card keeps its data. */
export function moveCardToBoard(
  ws: Workspace, fromId: string, cardId: string, toId: string, column: ColumnId = 'todo',
): Workspace {
  const from = ws.boards[fromId]
  const to = ws.boards[toId]
  const card = from?.board.cards[cardId]
  if (!from || !to || !card || fromId === toId || findColumn(from.board, cardId) === undefined) return ws
  const id = to.board.cards[cardId] ? newId() : cardId // avoid an id clash in the destination
  const dest = addCard(to.board, card, column, id)
  return {
    ...ws,
    boards: {
      ...ws.boards,
      [fromId]: { ...from, board: deleteCard(from.board, cardId) },
      [toId]: { ...to, board: dest },
    },
  }
}

// ---- persistence ----

/** Validate unknown data; returns null when nothing usable (caller falls back / migrates). */
export function parseWorkspace(raw: unknown): Workspace | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { boards?: unknown; order?: unknown; activeId?: unknown }
  if (!r.boards || typeof r.boards !== 'object' || !Array.isArray(r.order)) return null
  const src = r.boards as Record<string, { name?: unknown; board?: unknown }>
  const boards: Record<string, NamedBoard> = {}
  const order: string[] = []
  for (const id of r.order) {
    if (typeof id !== 'string' || boards[id] || !src[id]) continue
    const name = typeof src[id].name === 'string' ? cleanName(src[id].name as string) : ''
    boards[id] = { id, name: name || DEFAULT_BOARD_NAME, board: parseBoard(src[id].board) }
    order.push(id)
  }
  if (!order.length) return null
  const activeId = typeof r.activeId === 'string' && boards[r.activeId] ? r.activeId : order[0]
  return { boards, order, activeId }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function readJson(storage: StorageLike | undefined, key: string): unknown {
  try {
    const t = storage?.getItem(key)
    return t ? JSON.parse(t) : null
  } catch {
    return null
  }
}

/**
 * Load the workspace. If none is saved yet, the legacy single board (`kanban.board.v1`) becomes the first board,
 * with all its cards. The legacy entry is left in place as a backup.
 */
export function loadWorkspace(storage: StorageLike | undefined = safeStorage()): Workspace {
  const ws = parseWorkspace(readJson(storage, WORKSPACE_KEY))
  if (ws) return ws
  const legacy = readJson(storage, LEGACY_STORAGE_KEY)
  return workspaceFrom(legacy ? parseBoard(legacy) : emptyBoard())
}

export function saveWorkspace(ws: Workspace, storage: StorageLike | undefined = safeStorage()): boolean {
  try {
    storage?.setItem(WORKSPACE_KEY, JSON.stringify(ws))
    return !!storage
  } catch {
    return false
  }
}

export const totalCards = (b: Board) => COLUMN_IDS.reduce((n, c) => n + b.columns[c].length, 0)
