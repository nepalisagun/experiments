import { COLUMN_IDS, STORAGE_KEY, emptyBoard, newId, parseBoard, sanitizeBoard, type Board, type ColumnId } from './board'

export interface NamedBoard {
  id: string
  name: string
  board: Board
}

export interface Workspace {
  boards: NamedBoard[]
  activeId: string
}

export const WORKSPACE_KEY = 'kanban-workspace-v2'
export const DEFAULT_BOARD_NAME = 'My board'
export const MAX_NAME = 50

export function createWorkspace(board: Board = emptyBoard(), name = DEFAULT_BOARD_NAME): Workspace {
  const id = newId()
  return { boards: [{ id, name, board }], activeId: id }
}

export const activeBoard = (ws: Workspace): NamedBoard => ws.boards.find((b) => b.id === ws.activeId) ?? ws.boards[0]

/** Returns an error message, or null if `name` is usable. Names are unique, ignoring case. */
export function validateBoardName(ws: Workspace, name: string, ignoreId?: string): string | null {
  const n = name.trim()
  if (!n) return 'Name is required'
  if (n.length > MAX_NAME) return `Name must be ${MAX_NAME} characters or fewer`
  if (ws.boards.some((b) => b.id !== ignoreId && b.name.toLowerCase() === n.toLowerCase())) return 'A board with this name already exists'
  return null
}

export function addBoard(ws: Workspace, name: string, id = newId()): Workspace {
  if (validateBoardName(ws, name)) return ws
  return { boards: [...ws.boards, { id, name: name.trim(), board: emptyBoard() }], activeId: id }
}

export function renameBoard(ws: Workspace, id: string, name: string): Workspace {
  if (!ws.boards.some((b) => b.id === id) || validateBoardName(ws, name, id)) return ws
  return { ...ws, boards: ws.boards.map((b) => (b.id === id ? { ...b, name: name.trim() } : b)) }
}

/** Deletes a board. The last remaining board is never deleted. */
export function deleteBoard(ws: Workspace, id: string): Workspace {
  const i = ws.boards.findIndex((b) => b.id === id)
  if (i === -1 || ws.boards.length <= 1) return ws
  const boards = ws.boards.filter((b) => b.id !== id)
  const activeId = ws.activeId === id ? boards[Math.min(i, boards.length - 1)].id : ws.activeId
  return { boards, activeId }
}

export function setActiveBoard(ws: Workspace, id: string): Workspace {
  return ws.boards.some((b) => b.id === id) && ws.activeId !== id ? { ...ws, activeId: id } : ws
}

export function updateActiveBoard(ws: Workspace, fn: (b: Board) => Board): Workspace {
  const id = activeBoard(ws).id
  return { ...ws, boards: ws.boards.map((b) => (b.id === id ? { ...b, board: fn(b.board) } : b)) }
}

/** Move a card to another board, keeping its column (appended at the end). */
export function moveCardToBoard(ws: Workspace, cardId: string, fromId: string, toId: string): Workspace {
  if (fromId === toId) return ws
  const from = ws.boards.find((b) => b.id === fromId)
  const to = ws.boards.find((b) => b.id === toId)
  const card = from?.board.cards[cardId]
  if (!from || !to || !card) return ws
  const column = COLUMN_IDS.find((c) => from.board.columns[c].includes(cardId)) as ColumnId
  const fromCards = { ...from.board.cards }
  delete fromCards[cardId]
  const fromBoard: Board = {
    cards: fromCards,
    columns: { ...from.board.columns, [column]: from.board.columns[column].filter((x) => x !== cardId) },
  }
  // card ids are unique across boards in practice; guard against a clash anyway
  const id = to.board.cards[cardId] ? newId() : cardId
  const toBoard: Board = {
    cards: { ...to.board.cards, [id]: { ...card, id } },
    columns: { ...to.board.columns, [column]: [...to.board.columns[column], id] },
  }
  return { ...ws, boards: ws.boards.map((b) => (b.id === fromId ? { ...b, board: fromBoard } : b.id === toId ? { ...b, board: toBoard } : b)) }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Parse untrusted stored data; always yields a valid workspace with at least one board. */
export function parseWorkspace(rawV2: string | null, rawV1: string | null): Workspace {
  if (rawV2) {
    try {
      const data = JSON.parse(rawV2)
      const boards: NamedBoard[] = []
      const ids = new Set<string>()
      if (Array.isArray(data?.boards)) {
        for (const b of data.boards) {
          if (!b || typeof b.id !== 'string' || ids.has(b.id)) continue
          ids.add(b.id)
          const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, MAX_NAME) : `Board ${boards.length + 1}`
          boards.push({ id: b.id, name, board: sanitizeBoard(b.board) })
        }
      }
      if (boards.length) {
        const activeId = boards.some((b) => b.id === data.activeId) ? data.activeId : boards[0].id
        return { boards, activeId }
      }
    } catch {
      /* fall through */
    }
  }
  // First run of the multi-board version: the old single board becomes the first board.
  return createWorkspace(parseBoard(rawV1))
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function loadWorkspace(storage: StorageLike | undefined = safeStorage()): Workspace {
  let v2: string | null = null
  let v1: string | null = null
  try { v2 = storage?.getItem(WORKSPACE_KEY) ?? null } catch { /* ignore */ }
  try { v1 = storage?.getItem(STORAGE_KEY) ?? null } catch { /* ignore */ }
  return parseWorkspace(v2, v1)
}

/** The legacy single-board key is left untouched so nothing is ever lost. */
export function saveWorkspace(ws: Workspace, storage: StorageLike | undefined = safeStorage()): void {
  try {
    storage?.setItem(WORKSPACE_KEY, JSON.stringify(ws))
  } catch {
    /* quota or privacy mode: ignore */
  }
}
