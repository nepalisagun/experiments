import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'
import { applyTag, extractTags, normalizeTag, renameTag, suggestTags, tagCounts, tagQueryAt } from './tags'

describe('extractTags', () => {
  it('finds tags anywhere in the text, lower-cased and de-duplicated', () => {
    expect(extractTags('#Work stuff #todo\n- [ ] call #work, then (#home)')).toEqual(['work', 'todo', 'home'])
  })
  it('accepts -, _, / and digits inside a tag and drops trailing punctuation', () => {
    expect(extractTags('#work-items #a_b #project/alpha #v2. #todo- #x/')).toEqual([
      'work-items',
      'a_b',
      'project/alpha',
      'v2',
      'todo',
      'x',
    ])
  })
  it('handles non-English letters', () => {
    expect(extractTags('#zażółć #日本')).toEqual(['zażółć', '日本'])
  })
  it('ignores headings, numbers, mid-word #, URL fragments and anchor links', () => {
    expect(
      extractTags('# Heading\n## Sub\nissue #12\nC#sharp a#b\nhttps://x.com/#frag\n[x](#anchor)\n&#39;'),
    ).toEqual([])
  })
  it('ignores tags in fenced code and inline code', () => {
    expect(extractTags('```\n#include\n```\n~~~\n#x\n~~~\n`#nope` but #yes')).toEqual(['yes'])
  })
  it('finds tags inside emphasis, quotes and lists', () => {
    expect(extractTags('**#bold** "#quoted" > #q\n1. #num')).toEqual(['bold', 'quoted', 'q', 'num'])
  })
})

describe('tagCounts', () => {
  it('counts notes per tag (not occurrences), alphabetical', () => {
    expect(tagCounts(['#b #a #a', '#A', 'none', '#c #b'])).toEqual([
      { tag: 'a', count: 2 },
      { tag: 'b', count: 2 },
      { tag: 'c', count: 1 },
    ])
  })
})

describe('normalizeTag', () => {
  it('accepts a name with or without #', () => {
    expect(normalizeTag('#ideas')).toBe('ideas')
    expect(normalizeTag(' work-2 ')).toBe('work-2')
    expect(normalizeTag('a/b')).toBe('a/b')
  })
  it('rejects things that would not be a tag', () => {
    for (const bad of ['', '#', '12', 'two words', 'bad!', '-x', 'x-', '##x']) expect(normalizeTag(bad)).toBeNull()
  })
})

describe('renameTag', () => {
  it('renames every case variant as a whole tag only', () => {
    expect(renameTag('#work and #Work, #working, #work-items, #work/x', 'work', 'job')).toBe(
      '#job and #job, #working, #work-items, #work/x',
    )
  })
  it('leaves code blocks, inline code and non-tags alone', () => {
    const src = '# work\n`#work`\n```\n#work\n```\nemail#work #work'
    expect(renameTag(src, 'work', 'job')).toBe('# work\n`#work`\n```\n#work\n```\nemail#work #job')
  })
  it('keeps CRLF and other text unchanged', () => {
    expect(renameTag('a #x\r\nb #x.', 'x', 'y')).toBe('a #y\r\nb #y.')
  })
  it('the renamed tag is what extractTags then reports', () => {
    expect(extractTags(renameTag('#Old #other', 'old', 'new-name'))).toEqual(['new-name', 'other'])
  })
})

describe('tagQueryAt (autocomplete trigger)', () => {
  const at = (s: string) => tagQueryAt(s.replace('|', ''), s.indexOf('|'))
  it('detects a # being typed', () => {
    expect(at('hello #|')).toEqual({ start: 6, prefix: '' })
    expect(at('hello #wo|')).toEqual({ start: 6, prefix: 'wo' })
    expect(at('#wo|')).toEqual({ start: 0, prefix: 'wo' })
    expect(at('line\n(#a/b|')).toEqual({ start: 6, prefix: 'a/b' })
  })
  it('does not trigger after a space, mid-word, or in code', () => {
    expect(at('# |')).toBeNull()
    expect(at('#wo |')).toBeNull()
    expect(at('a#wo|')).toBeNull()
    expect(at('`#wo|')).toBeNull()
    expect(at('```\n#inc|')).toBeNull()
    expect(at('```\nx\n```\n#ok|')).toEqual({ start: 10, prefix: 'ok' })
  })
})

describe('suggestTags', () => {
  const tags = ['work', 'workout', 'homework', 'ideas', 'w']
  it('prefix matches first, then substring matches, excluding the exact tag typed', () => {
    expect(suggestTags(tags, 'work')).toEqual(['workout', 'homework'])
    expect(suggestTags(tags, 'WO')).toEqual(['work', 'workout', 'homework'])
    expect(suggestTags(tags, '')).toEqual(['homework', 'ideas', 'w', 'work', 'workout'])
    expect(suggestTags(tags, 'zzz')).toEqual([])
  })
  it('limits the list', () => {
    expect(suggestTags(tags, '', 2)).toHaveLength(2)
  })
})

describe('applyTag', () => {
  it('replaces the partial tag and adds a space', () => {
    const md = 'buy #gr'
    const r = applyTag(md, { start: 4, prefix: 'gr' }, 7, 'groceries')
    expect(r.text).toBe('buy #groceries ')
    expect(r.caret).toBe(15)
    expect(md.slice(0, r.from) + r.insert + md.slice(r.to)).toBe(r.text)
  })
  it('does not double a following space and swallows the rest of the word', () => {
    expect(applyTag('#gr x', { start: 0, prefix: 'gr' }, 3, 'groceries').text).toBe('#groceries x')
    expect(applyTag('#grXYZ x', { start: 0, prefix: 'gr' }, 3, 'groceries').text).toBe('#groceries x')
  })
})

describe('tags in the preview', () => {
  it('renders tags as safe, clickable chips', () => {
    expect(renderMarkdown('hi #Work')).toBe(
      '<p>hi <button type="button" class="tag" data-tag="work">#Work</button></p>',
    )
  })
  it('does not render chips for headings, code or link anchors', () => {
    const html = renderMarkdown('# Title\n\n`#x` [a](#b) https://x.com/#c\n\n```\n#d\n```')
    expect(html).not.toContain('class="tag"')
  })
  it('renders chips inside lists, tasks and emphasis', () => {
    const html = renderMarkdown('- [ ] call #home\n- **#urgent**')
    expect(html).toContain('data-tag="home"')
    expect(html).toContain('<strong><button type="button" class="tag" data-tag="urgent">#urgent</button></strong>')
  })
})
