const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  pin: 'M12 17v5M9 10.76V4h6v6.76l2.5 2.74V16h-11v-2.5L9 10.76zM8 4h8',
  'pin-filled': 'M12 17v5M9 10.76V4h6v6.76l2.5 2.74V16h-11v-2.5L9 10.76zM8 4h8',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  back: 'M15 18l-6-6 6-6',
  check: 'M20 6 9 17l-5-5',
  close: 'M18 6 6 18M6 6l12 12',
}

export function Icon({ name, className = 'size-5' }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={name === 'pin-filled' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
