const COPIED = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'tabSize',
  'textIndent',
  'textTransform',
  'wordSpacing',
] as const

/**
 * Pixel position of a character offset inside a textarea, relative to the
 * textarea's top-left corner and accounting for its scroll position.
 * Uses an off-screen mirror element with the same text layout.
 */
export function caretCoordinates(ta: HTMLTextAreaElement, pos: number): { top: number; left: number; height: number } {
  const style = getComputedStyle(ta)
  const mirror = document.createElement('div')
  const s = mirror.style
  for (const prop of COPIED) s[prop] = style[prop]
  s.position = 'absolute'
  s.visibility = 'hidden'
  s.top = '0'
  s.left = '-9999px'
  s.whiteSpace = 'pre-wrap'
  s.overflowWrap = 'break-word'
  s.overflow = 'hidden'
  // Match the textarea's content width when it shows a scrollbar.
  s.width = `${ta.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`
  mirror.textContent = ta.value.slice(0, pos)
  const marker = document.createElement('span')
  marker.textContent = ta.value.slice(pos) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4
  const result = {
    top: marker.offsetTop - ta.scrollTop,
    left: marker.offsetLeft - ta.scrollLeft,
    height: lineHeight,
  }
  document.body.removeChild(mirror)
  return result
}
