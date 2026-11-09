import { useCallback, useEffect, useRef, useState } from 'react'
import type { ColumnId } from './board'

export interface DropTarget {
  column: ColumnId
  beforeId: string | null
}

export interface DragView {
  id: string
  x: number
  y: number
  offsetX: number
  offsetY: number
  width: number
  target: DropTarget | null
}

const THRESHOLD = 5
const EDGE = 64

/** Work out which column / position is under the pointer. */
function dropTargetAt(x: number, y: number, draggedId: string): DropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const colEl = el?.closest<HTMLElement>('[data-column]')
  if (!colEl) return null
  const column = colEl.dataset.column as ColumnId
  const cardEls = Array.from(colEl.querySelectorAll<HTMLElement>('[data-card-id]')).filter(
    (c) => c.dataset.cardId !== draggedId,
  )
  for (const c of cardEls) {
    const r = c.getBoundingClientRect()
    if (y < r.top + r.height / 2) return { column, beforeId: c.dataset.cardId ?? null }
  }
  return { column, beforeId: null }
}

/**
 * Pointer-event based drag and drop: one code path for mouse, touch and pen.
 * Mouse can drag from anywhere on the card; touch/pen drag from the grip handle
 * (which has `touch-action: none`) so the rest of the card still scrolls the page.
 */
export function useCardDrag(onDrop: (id: string, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragView | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const suppressClick = useRef(false)
  const onDropRef = useRef(onDrop)
  useEffect(() => {
    onDropRef.current = onDrop
  })
  useEffect(() => () => cleanupRef.current?.(), [])

  const startDrag = useCallback((e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || cleanupRef.current) return
    const targetEl = e.target as HTMLElement
    const onHandle = !!targetEl.closest('[data-drag-handle]')
    if (!onHandle && targetEl.closest('button, select, input, textarea, a, label')) return
    if (e.pointerType !== 'mouse' && !onHandle) return

    const cardEl = e.currentTarget
    const rect = cardEl.getBoundingClientRect()
    const pointerId = e.pointerId
    const startX = e.clientX
    const startY = e.clientY
    const offsetX = startX - rect.left
    const offsetY = startY - rect.top
    let active = false
    let last = { x: startX, y: startY }
    let target: DropTarget | null = null
    let raf = 0

    const render = () => {
      target = dropTargetAt(last.x, last.y, id)
      setDrag({ id, x: last.x, y: last.y, offsetX, offsetY, width: rect.width, target })
    }

    const autoScroll = () => {
      let dy = 0
      if (last.y < EDGE) dy = -Math.ceil((EDGE - last.y) / 3)
      else if (last.y > window.innerHeight - EDGE) dy = Math.ceil((last.y - (window.innerHeight - EDGE)) / 3)
      if (dy) {
        window.scrollBy(0, dy)
        render()
      }
      raf = requestAnimationFrame(autoScroll)
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      last = { x: ev.clientX, y: ev.clientY }
      if (!active) {
        if (Math.hypot(last.x - startX, last.y - startY) < THRESHOLD) return
        active = true
        document.body.classList.add('is-dragging')
        raf = requestAnimationFrame(autoScroll)
      }
      ev.preventDefault()
      render()
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      cancelAnimationFrame(raf)
      document.body.classList.remove('is-dragging')
      cleanupRef.current = null
      setDrag(null)
    }

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const wasActive = active
      const finalTarget = active ? dropTargetAt(ev.clientX, ev.clientY, id) : null
      cleanup()
      if (wasActive) {
        // The browser fires a click after pointerup; don't let it hit a button.
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 0)
        if (finalTarget) onDropRef.current(id, finalTarget)
      }
    }

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) cleanup()
    }

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && active) {
        ev.preventDefault()
        ev.stopPropagation()
        cleanup()
      }
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    cleanupRef.current = cleanup
  }, [])

  return { drag, startDrag, suppressClick }
}
