import { type Card, newId, parseBoard, STORAGE_KEY as LEGACY_KEY } from './board'

export interface Board {
  id: string
  name: string
  cards: Card[]
}

export interface Workspace {
  activeBoardId: string
  boards: Board[]
}

export const WORKSPACE_KEY = 'kanban-workspace-v2'
export const DEFAULT_BOARD_NAME = 'My board'
export const MAX_BOARD_NAME = 60

export function createWorkspace(cards: Card[] = [], name = DEFAULT_BOARD_NAME, id: string = newId()): Workspace {
  return { activeBoardId: id, boards: [{ id, name, cards }] }
}

export function activeBoard(ws: Workspace): Board {
  return ws.boards.find((b) => b.id === ws.activeBoardId) ?? ws.boards[0]
}

export function setActiveBoard(ws: Workspace, id: string): Workspace {
  return ws.boards.some((b) => b.id === id) ? { ...ws, activeBoardId: id } : ws
}

/** Returns an error message, or null when the name is acceptable. */
export function validateBoardName(ws: Workspace, name: string, exceptId?: string): string | null {
  const n = name.trim()
  if (!n) return 'Board name is required.'
  if (n.length > MAX_BOARD_NAME) return `Board name must be at most ${MAX_BOARD_NAME} characters.`
  if (ws.boards.some((b) => b.id !== exceptId && b.name.trim().toLowerCase() === n.toLowerCase())) {
    return 'A board with this name already exists.'
  }
  return null
}

/** Suggest "Board N" that isn't taken yet. */
export function suggestBoardName(ws: Workspace): string {
  for (let i = ws.boards.length + 1; ; i++) {
    const name = `Board ${i}`
    if (!validateBoardName(ws, name)) return name
  }
}

/** Add a board and make it active. Invalid names are rejected (workspace returned unchanged). */
export function addBoard(ws: Workspace, name: string, id: string = newId()): Workspace {
  if (validateBoardName(ws, name)) return ws
  return { activeBoardId: id, boards: [...ws.boards, { id, name: name.trim(), cards: [] }] }
}

export function renameBoard(ws: Workspace, id: string, name: string): Workspace {
  if (validateBoardName(ws, name, id)) return ws
  return { ...ws, boards: ws.boards.map((b) => (b.id === id ? { ...b, name: name.trim() } : b)) }
}

export function canDeleteBoard(ws: Workspace): boolean {
  return ws.boards.length > 1
}

/** Delete a board. The last remaining board can never be deleted. */
export function deleteBoard(ws: Workspace, id: string): Workspace {
  const idx = ws.boards.findIndex((b) => b.id === id)
  if (idx < 0 || !canDeleteBoard(ws)) return ws
  const boards = ws.boards.filter((b) => b.id !== id)
  const activeBoardId = ws.activeBoardId === id ? boards[Math.min(idx, boards.length - 1)].id : ws.activeBoardId
  return { activeBoardId, boards }
}

export function setBoardCards(ws: Workspace, boardId: string, cards: Card[]): Workspace {
  return { ...ws, boards: ws.boards.map((b) => (b.id === boardId ? { ...b, cards } : b)) }
}

/** Move a card to another board, keeping its column and appending it to the end of that column. */
export function moveCardToBoard(ws: Workspace, cardId: string, fromBoardId: string, toBoardId: string): Workspace {
  if (fromBoardId === toBoardId) return ws
  const from = ws.boards.find((b) => b.id === fromBoardId)
  const to = ws.boards.find((b) => b.id === toBoardId)
  const card = from?.cards.find((c) => c.id === cardId)
  if (!from || !to || !card) return ws
  return {
    ...ws,
    boards: ws.boards.map((b) => {
      if (b.id === fromBoardId) return { ...b, cards: b.cards.filter((c) => c.id !== cardId) }
      if (b.id === toBoardId) return { ...b, cards: [...b.cards, card] }
      return b
    }),
  }
}

/** Parse stored v2 data. Returns null if it is missing or unusable (so callers can fall back). */
export function parseWorkspace(raw: string | null): Workspace | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const d = data as { boards?: unknown; activeBoardId?: unknown }
  if (!d || typeof d !== 'object' || !Array.isArray(d.boards)) return null
  const boards: Board[] = []
  const boardIds = new Set<string>()
  const cardIds = new Set<string>()
  for (const item of d.boards) {
    if (!item || typeof item !== 'object') continue
    const b = item as Record<string, unknown>
    let id = typeof b.id === 'string' && b.id ? b.id : newId()
    if (boardIds.has(id)) id = newId()
    boardIds.add(id)
    let name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, MAX_BOARD_NAME) : `Board ${boards.length + 1}`
    // Keep names unique so the switcher stays unambiguous.
    const base = name
    for (let i = 2; boards.some((x) => x.name.toLowerCase() === name.toLowerCase()); i++) name = `${base} (${i})`
    // Reuse the per-card validation from the single-board format.
    const cards = parseBoard(JSON.stringify(Array.isArray(b.cards) ? b.cards : [])).map((c) => {
      // Card ids must be unique across boards (moving cards relies on it); never drop a card for this.
      const card = cardIds.has(c.id) ? { ...c, id: newId() } : c
      cardIds.add(card.id)
      return card
    })
    boards.push({ id, name, cards })
  }
  if (boards.length === 0) return null
  const activeBoardId = boards.some((b) => b.id === d.activeBoardId) ? (d.activeBoardId as string) : boards[0].id
  return { activeBoardId, boards }
}

export function serializeWorkspace(ws: Workspace): string {
  return JSON.stringify({ version: 2, ...ws })
}

/**
 * Load the workspace. If there is no (valid) v2 data yet, migrate the single board
 * saved by the previous version so no cards are lost. The legacy key is left untouched.
 */
export function loadWorkspace(storage: Pick<Storage, 'getItem'> = localStorage): Workspace {
  const get = (k: string): string | null => {
    try {
      return storage.getItem(k)
    } catch {
      return null
    }
  }
  const ws = parseWorkspace(get(WORKSPACE_KEY))
  if (ws) return ws
  return createWorkspace(parseBoard(get(LEGACY_KEY)))
}

export function saveWorkspace(ws: Workspace, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    storage.setItem(WORKSPACE_KEY, serializeWorkspace(ws))
    return true
  } catch {
    return false
  }
}
