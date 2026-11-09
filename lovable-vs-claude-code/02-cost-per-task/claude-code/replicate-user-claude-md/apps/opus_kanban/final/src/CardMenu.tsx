import { useEffect, useId, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  hint?: string
  danger?: boolean
}

/** A "⋯" menu button following the WAI-ARIA menu button pattern. */
export function CardMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const itemEls = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    itemEls()[0]?.focus()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const toggle = () => {
    if (!open) {
      const r = buttonRef.current!.getBoundingClientRect()
      setUp(window.innerHeight - r.bottom < 40 * items.length + 24 && r.top > window.innerHeight - r.bottom)
    }
    setOpen((o) => !o)
  }

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = itemEls()
    const i = els.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => {
      e.preventDefault()
      els[(n + els.length) % els.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(els.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') close(false)
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-label={label}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-action="menu"
        onClick={toggle}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault()
            toggle()
          }
        }}
      >
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-current">
          <circle cx="4" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          onClick={(e) => e.stopPropagation()}
          className={`absolute right-0 z-30 min-w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800 ${
            up ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={item.disabled || undefined}
              onClick={() => {
                if (item.disabled) return
                close()
                item.onSelect()
              }}
              className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm outline-none focus:bg-slate-100 dark:focus:bg-slate-700 ${
                item.disabled
                  ? 'cursor-not-allowed text-slate-400 dark:text-slate-500'
                  : item.danger
                    ? 'cursor-pointer text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'
                    : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <span>{item.label}</span>
              {item.hint && <span className="text-xs text-slate-500 dark:text-slate-400">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
