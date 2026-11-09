// Pure multi-board logic. Covered by src/workspace.test.ts.
import { type Board, COLUMNS, type ColumnId, emptyBoard, findCard, newId, parseBoard, STORAGE_KEY as LEGACY_KEY } from './board'

export interface NamedBoard {
  id: string
  name: string
  columns: Board
}

export interface Workspace {
  activeBoardId: string
  boards: NamedBoard[]
}

export const WORKSPACE_KEY = 'personal-kanban.workspace.v2'
export const BACKUP_KEY = 'personal-kanban.workspace.v2.unreadable-backup'
export const DEFAULT_BOARD_NAME = 'My board'
export const MAX_NAME_LENGTH = 60

export function newWorkspace(columns: Board = emptyBoard(), id = newId()): Workspace {
  return { activeBoardId: id, boards: [{ id, name: DEFAULT_BOARD_NAME, columns }] }
}

export const activeBoard = (ws: Workspace): NamedBoard => ws.boards.find((b) => b.id === ws.activeBoardId) ?? ws.boards[0]

/** Trims and validates a board name; `exceptId` is the board being renamed. */
export function validateBoardName(ws: Workspace, raw: string, exceptId?: string): { name: string; error: string | null } {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name) return { name, error: 'Board name is required.' }
  if (name.length > MAX_NAME_LENGTH) return { name, error: `Board name must be at most ${MAX_NAME_LENGTH} characters.` }
  if (ws.boards.some((b) => b.id !== exceptId && b.name.toLowerCase() === name.toLowerCase()))
    return { name, error: 'A board with this name already exists.' }
  return { name, error: null }
}

/** Adds an empty board after the others and makes it active. Invalid names leave the workspace unchanged. */
export function createBoard(ws: Workspace, rawName: string, id = newId()): Workspace {
  const { name, error } = validateBoardName(ws, rawName)
  if (error) return ws
  return { activeBoardId: id, boards: [...ws.boards, { id, name, columns: emptyBoard() }] }
}

export function renameBoard(ws: Workspace, id: string, rawName: string): Workspace {
  const { name, error } = validateBoardName(ws, rawName, id)
  if (error || !ws.boards.some((b) => b.id === id)) return ws
  return { ...ws, boards: ws.boards.map((b) => (b.id === id ? { ...b, name } : b)) }
}

export const canDeleteBoard = (ws: Workspace) => ws.boards.length > 1

/** Deletes a board, never the last one. If it was active, its neighbour (the next one, else the previous) becomes active. */
export function deleteBoard(ws: Workspace, id: string): Workspace {
  const idx = ws.boards.findIndex((b) => b.id === id)
  if (idx === -1 || !canDeleteBoard(ws)) return ws
  const boards = ws.boards.filter((b) => b.id !== id)
  const activeBoardId = ws.activeBoardId === id ? boards[Math.min(idx, boards.length - 1)].id : ws.activeBoardId
  return { activeBoardId, boards }
}

export function switchBoard(ws: Workspace, id: string): Workspace {
  return ws.boards.some((b) => b.id === id) && ws.activeBoardId !== id ? { ...ws, activeBoardId: id } : ws
}

/** Applies a column-level update (from board.ts) to one board; returns the same workspace when nothing changed. */
export function updateBoardColumns(ws: Workspace, boardId: string, fn: (columns: Board) => Board): Workspace {
  let changed = false
  const boards = ws.boards.map((b) => {
    if (b.id !== boardId) return b
    const columns = fn(b.columns)
    if (columns === b.columns) return b
    changed = true
    return { ...b, columns }
  })
  return changed ? { ...ws, boards } : ws
}

/**
 * Moves a card from one board to the end of `column` on another board
 * (defaults to the column it is in now). The active board does not change.
 */
export function moveCardToBoard(ws: Workspace, cardId: string, fromBoardId: string, toBoardId: string, column?: ColumnId): Workspace {
  if (fromBoardId === toBoardId) return ws
  const from = ws.boards.find((b) => b.id === fromBoardId)
  const to = ws.boards.find((b) => b.id === toBoardId)
  const found = from && findCard(from.columns, cardId)
  if (!from || !to || !found) return ws
  const targetColumn = column ?? found.column
  // Card ids are unique in practice; regenerate on the off chance the target already has this one.
  const card = findCard(to.columns, cardId) ? { ...found.card, id: newId() } : found.card
  return {
    ...ws,
    boards: ws.boards.map((b) => {
      if (b.id === fromBoardId)
        return { ...b, columns: { ...b.columns, [found.column]: b.columns[found.column].filter((c) => c.id !== cardId) } }
      if (b.id === toBoardId) return { ...b, columns: { ...b.columns, [targetColumn]: [...b.columns[targetColumn], card] } }
      return b
    }),
  }
}

export const countCards = (columns: Board) => COLUMNS.reduce((n, c) => n + columns[c.id].length, 0)

// ---------- persistence ----------

/** Parses stored JSON defensively. Returns null when it is not a usable workspace. */
export function parseWorkspace(raw: string | null): Workspace | null {
  if (raw == null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as { boards?: unknown }).boards)) return null
  const boards: NamedBoard[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const item of (data as { boards: unknown[] }).boards) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const columns = parseBoard(JSON.stringify(o.columns ?? {}))
    if (typeof o.id !== 'string' || !o.id || ids.has(o.id) || !columns) continue
    let name = typeof o.name === 'string' ? o.name.trim().slice(0, MAX_NAME_LENGTH) : ''
    if (!name) name = `Board ${boards.length + 1}`
    // Keep names unique so the switcher never shows two identical entries.
    for (let n = 2, base = name; names.has(name.toLowerCase()); n++) name = `${base} (${n})`
    ids.add(o.id)
    names.add(name.toLowerCase())
    boards.push({ id: o.id, name, columns })
  }
  if (boards.length === 0) return null
  const active = (data as { activeBoardId?: unknown }).activeBoardId
  return { activeBoardId: typeof active === 'string' && ids.has(active) ? active : boards[0].id, boards }
}

/**
 * Loads the workspace. When none is saved yet, the single board saved by
 * earlier versions (LEGACY_KEY) becomes the first board, cards and order intact.
 * The legacy key is left untouched so a rollback can still read it.
 * Unreadable workspace data is copied to BACKUP_KEY before being replaced.
 */
export function loadWorkspace(storage: Pick<Storage, 'getItem' | 'setItem'>): Workspace {
  let raw: string | null = null
  try {
    raw = storage.getItem(WORKSPACE_KEY)
  } catch {
    return newWorkspace()
  }
  const ws = parseWorkspace(raw)
  if (ws) return ws
  if (raw != null) {
    try {
      storage.setItem(BACKUP_KEY, raw)
    } catch {
      /* best effort */
    }
  }
  let legacy: Board | null = null
  try {
    legacy = parseBoard(storage.getItem(LEGACY_KEY))
  } catch {
    /* fall through to an empty workspace */
  }
  return newWorkspace(legacy ?? emptyBoard())
}

export function saveWorkspace(storage: Pick<Storage, 'setItem'>, ws: Workspace): boolean {
  try {
    storage.setItem(WORKSPACE_KEY, JSON.stringify(ws))
    return true
  } catch {
    return false
  }
}
