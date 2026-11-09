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
  'textTransform',
  'wordSpacing',
] as const

/**
 * Pixel position of character `index` inside a textarea, relative to the
 * textarea's top-left corner and accounting for its scroll. Uses a hidden
 * mirror element with the same text metrics.
 */
export function caretCoordinates(el: HTMLTextAreaElement, index: number): { top: number; left: number; height: number } {
  const style = getComputedStyle(el)
  const mirror = document.createElement('div')
  const ms = mirror.style
  for (const p of COPIED) ms[p] = style[p]
  ms.position = 'absolute'
  ms.visibility = 'hidden'
  ms.top = '0'
  ms.left = '-9999px'
  ms.whiteSpace = 'pre-wrap'
  ms.overflowWrap = 'break-word'
  // Match the textarea's scrollbar so lines wrap at the same width.
  ms.overflowY = el.scrollHeight > el.clientHeight ? 'scroll' : 'hidden'
  mirror.textContent = el.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = el.value.slice(index) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4
  const pos = {
    top: marker.offsetTop - el.scrollTop,
    left: marker.offsetLeft - el.scrollLeft,
    height: lineHeight,
  }
  mirror.remove()
  return pos
}
