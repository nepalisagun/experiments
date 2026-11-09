import { Marked } from 'marked'
import DOMPurify from 'dompurify'

// Raw HTML in a note is shown as literal text, never parsed; output is also sanitized.
const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    },
    checkbox({ checked }) {
      return `<input type="checkbox" data-task${checked ? ' checked' : ''}> `
    },
  },
})

let hooked = false
function ensureHook() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

export function sanitize(html: string): string {
  ensureHook()
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-task'] })
}

export function renderMarkdown(src: string): string {
  return sanitize(marked.parse(src, { async: false }) as string)
}
