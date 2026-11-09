import { describe, expect, it } from 'vitest'
import { type Card, STORAGE_KEY as LEGACY_KEY, serializeBoard } from './board'
import {
  activeBoard,
  addBoard,
  canDeleteBoard,
  createWorkspace,
  deleteBoard,
  loadWorkspace,
  moveCardToBoard,
  parseWorkspace,
  renameBoard,
  saveWorkspace,
  setActiveBoard,
  setBoardCards,
  suggestBoardName,
  validateBoardName,
  WORKSPACE_KEY,
  type Workspace,
} from './workspace'

const card = (id: string, column: Card['column'] = 'todo', extra: Partial<Card> = {}): Card => ({
  id, title: `Card ${id}`, description: '', due: '', priority: 'medium', column, ...extra,
})

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

/** Two boards: "Work" (active, cards a,b) and "Home" (card c). */
function ws2(): Workspace {
  let ws = createWorkspace([card('a'), card('b', 'doing')], 'Work', 'w')
  ws = addBoard(ws, 'Home', 'h')
  ws = setBoardCards(ws, 'h', [card('c', 'done')])
  return setActiveBoard(ws, 'w')
}

describe('creating and switching boards', () => {
  it('creates a workspace with one active board', () => {
    const ws = createWorkspace([], undefined, 'x')
    expect(ws).toEqual({ activeBoardId: 'x', boards: [{ id: 'x', name: 'My board', cards: [] }] })
    expect(activeBoard(ws).id).toBe('x')
  })
  it('adds a board with trimmed name, empty cards, and makes it active', () => {
    const ws = addBoard(createWorkspace([card('a')], 'One', 'b1'), '  Two  ', 'b2')
    expect(ws.boards.map((b) => b.name)).toEqual(['One', 'Two'])
    expect(ws.activeBoardId).toBe('b2')
    expect(activeBoard(ws).cards).toEqual([])
    expect(ws.boards[0].cards).toHaveLength(1) // other board untouched
  })
  it('rejects invalid or duplicate names', () => {
    const ws = createWorkspace([], 'One')
    expect(addBoard(ws, '   ')).toBe(ws)
    expect(addBoard(ws, 'one')).toBe(ws)
    expect(addBoard(ws, 'x'.repeat(61))).toBe(ws)
  })
  it('switches the active board, ignoring unknown ids', () => {
    const ws = ws2()
    expect(setActiveBoard(ws, 'h').activeBoardId).toBe('h')
    expect(setActiveBoard(ws, 'nope')).toBe(ws)
  })
  it('falls back to the first board if the active id is stale', () => {
    expect(activeBoard({ ...ws2(), activeBoardId: 'gone' }).id).toBe('w')
  })
  it('suggests an unused "Board N" name', () => {
    expect(suggestBoardName(ws2())).toBe('Board 3')
    expect(suggestBoardName(addBoard(ws2(), 'Board 3'))).toBe('Board 4')
  })
})

describe('validateBoardName', () => {
  it('explains what is wrong', () => {
    const ws = ws2()
    expect(validateBoardName(ws, '')).toMatch(/required/)
    expect(validateBoardName(ws, ' HOME ')).toMatch(/already exists/)
    expect(validateBoardName(ws, 'x'.repeat(61))).toMatch(/at most 60/)
    expect(validateBoardName(ws, 'Garden')).toBeNull()
  })
  it('allows keeping (or re-casing) the board\'s own name', () => {
    expect(validateBoardName(ws2(), 'home', 'h')).toBeNull()
    expect(validateBoardName(ws2(), 'home', 'w')).toMatch(/already exists/)
  })
})

describe('rename and delete', () => {
  it('renames only the target board', () => {
    const ws = renameBoard(ws2(), 'h', ' House ')
    expect(ws.boards.map((b) => b.name)).toEqual(['Work', 'House'])
    expect(ws.boards[1].cards).toEqual([card('c', 'done')])
  })
  it('ignores invalid renames', () => {
    const ws = ws2()
    expect(renameBoard(ws, 'h', '')).toBe(ws)
    expect(renameBoard(ws, 'h', 'Work')).toBe(ws)
  })
  it('deletes a board and its cards', () => {
    const ws = deleteBoard(ws2(), 'h')
    expect(ws.boards.map((b) => b.id)).toEqual(['w'])
    expect(ws.activeBoardId).toBe('w')
  })
  it('activates a neighbour when the active board is deleted', () => {
    let ws = addBoard(ws2(), 'Third', 't') // boards w, h, t
    ws = setActiveBoard(ws, 'h')
    expect(deleteBoard(ws, 'h').activeBoardId).toBe('t') // next one
    ws = setActiveBoard(ws, 't')
    expect(deleteBoard(ws, 't').activeBoardId).toBe('h') // last → previous
  })
  it('never deletes the last board', () => {
    const one = createWorkspace([card('a')])
    expect(canDeleteBoard(one)).toBe(false)
    expect(deleteBoard(one, one.activeBoardId)).toBe(one)
    expect(canDeleteBoard(ws2())).toBe(true)
  })
  it('ignores unknown board ids', () => {
    const ws = ws2()
    expect(deleteBoard(ws, 'nope')).toBe(ws)
  })
})

describe('moveCardToBoard', () => {
  it('moves a card, keeping its column and fields, to the end of that column', () => {
    let ws = setBoardCards(ws2(), 'h', [card('c', 'doing'), card('d', 'done')])
    ws = moveCardToBoard(ws, 'b', 'w', 'h')
    expect(ws.boards[0].cards.map((c) => c.id)).toEqual(['a'])
    expect(ws.boards[1].cards.map((c) => c.id)).toEqual(['c', 'd', 'b'])
    expect(ws.boards[1].cards[2]).toEqual(card('b', 'doing'))
  })
  it('does not change the active board', () => {
    expect(moveCardToBoard(ws2(), 'a', 'w', 'h').activeBoardId).toBe('w')
  })
  it('is a no-op for same board or unknown ids', () => {
    const ws = ws2()
    expect(moveCardToBoard(ws, 'a', 'w', 'w')).toBe(ws)
    expect(moveCardToBoard(ws, 'zz', 'w', 'h')).toBe(ws)
    expect(moveCardToBoard(ws, 'a', 'w', 'nope')).toBe(ws)
    expect(moveCardToBoard(ws, 'c', 'w', 'h')).toBe(ws) // card is not on the source board
  })
})

describe('persistence and migration', () => {
  it('round-trips through storage, including the active board', () => {
    const s = memoryStorage()
    const ws = setActiveBoard(ws2(), 'h')
    expect(saveWorkspace(ws, s)).toBe(true)
    expect(loadWorkspace(s)).toEqual(ws)
    expect(JSON.parse(s.map.get(WORKSPACE_KEY)!).version).toBe(2)
  })
  it('migrates the old single-board data into the first board without losing cards', () => {
    const old = [card('a'), card('b', 'doing', { priority: 'high', due: '2026-01-01', description: 'd' }), card('c', 'done')]
    const s = memoryStorage({ [LEGACY_KEY]: serializeBoard(old) })
    const ws = loadWorkspace(s)
    expect(ws.boards).toHaveLength(1)
    expect(ws.boards[0].name).toBe('My board')
    expect(ws.boards[0].cards).toEqual(old) // same cards, same order, same fields
    expect(ws.activeBoardId).toBe(ws.boards[0].id)
  })
  it('keeps the legacy data untouched when saving', () => {
    const legacy = serializeBoard([card('a')])
    const s = memoryStorage({ [LEGACY_KEY]: legacy })
    saveWorkspace(loadWorkspace(s), s)
    expect(s.map.get(LEGACY_KEY)).toBe(legacy)
  })
  it('prefers v2 data over legacy data once it exists', () => {
    const s = memoryStorage({ [LEGACY_KEY]: serializeBoard([card('old')]) })
    saveWorkspace(ws2(), s)
    expect(loadWorkspace(s).boards.map((b) => b.name)).toEqual(['Work', 'Home'])
  })
  it('falls back to legacy data if v2 data is corrupt', () => {
    const s = memoryStorage({ [LEGACY_KEY]: serializeBoard([card('a')]), [WORKSPACE_KEY]: '{oops' })
    expect(loadWorkspace(s).boards[0].cards.map((c) => c.id)).toEqual(['a'])
  })
  it('starts with one empty board when nothing is saved or storage throws', () => {
    const fresh = loadWorkspace(memoryStorage())
    expect(fresh.boards).toHaveLength(1)
    expect(fresh.boards[0].cards).toEqual([])
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } }
    expect(loadWorkspace(throwing).boards).toHaveLength(1)
    expect(saveWorkspace(ws2(), throwing)).toBe(false)
  })
  it('repairs bad v2 data without dropping valid cards', () => {
    const raw = JSON.stringify({
      version: 2,
      activeBoardId: 'missing',
      boards: [
        { id: 'x', name: 'Same', cards: [card('a'), { id: 'bad', title: '' }] },
        { id: 'x', name: 'same', cards: [card('a', 'done')] }, // duplicate board id, name and card id
        { name: '', cards: 'nope' },
        null,
      ],
    })
    const ws = parseWorkspace(raw)!
    expect(ws.boards).toHaveLength(3)
    expect(new Set(ws.boards.map((b) => b.id)).size).toBe(3)
    expect(ws.boards.map((b) => b.name)).toEqual(['Same', 'same (2)', 'Board 3'])
    expect(ws.activeBoardId).toBe('x')
    expect(ws.boards[0].cards.map((c) => c.id)).toEqual(['a'])
    // The duplicate card is kept with a fresh id.
    expect(ws.boards[1].cards).toHaveLength(1)
    expect(ws.boards[1].cards[0].id).not.toBe('a')
    expect(ws.boards[1].cards[0].column).toBe('done')
  })
  it('rejects unusable v2 data', () => {
    expect(parseWorkspace(null)).toBeNull()
    expect(parseWorkspace('[]')).toBeNull()
    expect(parseWorkspace('{"boards": []}')).toBeNull()
    expect(parseWorkspace('{"boards": [null]}')).toBeNull()
  })
})
