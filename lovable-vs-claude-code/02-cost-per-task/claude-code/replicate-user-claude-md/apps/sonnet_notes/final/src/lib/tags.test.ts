import { describe, expect, it } from 'vitest'
import {
  activeTagToken, applySuggestion, extractTags, filterByTag, normalizeTagName,
  renameTagInText, suggestTags, tagCounts,
} from './tags'

describe('extractTags', () => {
  it('finds tags, lower-cased and unique', () => {
    expect(extractTags('Hello #Work and #home, again #work.\n#idea')).toEqual(['work', 'home', 'idea'])
  })
  it('supports unicode, digits, underscores and hyphens', () => {
    expect(extractTags('#żółć #todo_1 #my-tag')).toEqual(['żółć', 'todo_1', 'my-tag'])
  })
  it('ignores headings, urls, anchors, numbers and mid-word hashes', () => {
    expect(extractTags('# Heading\n## Sub\nhttp://x.com/#frag a#b #123 [l](#anchor-less) x&#39;')).toEqual(['anchor-less'])
  })
  it('ignores code', () => {
    expect(extractTags('`#inline` and\n```\n#fenced\n```\n~~~\n#tilde\n~~~\n#real')).toEqual(['real'])
  })
})

describe('tagCounts / filterByTag', () => {
  const notes = [{ content: '#a #b #a' }, { content: '#b' }, { content: 'none' }]
  it('counts notes, not occurrences', () => {
    expect(tagCounts(notes)).toEqual([{ tag: 'a', count: 1 }, { tag: 'b', count: 2 }])
  })
  it('filters', () => {
    expect(filterByTag(notes, 'b')).toHaveLength(2)
    expect(filterByTag(notes, 'a')).toHaveLength(1)
    expect(filterByTag(notes, null)).toHaveLength(3)
    expect(filterByTag(notes, 'zzz')).toHaveLength(0)
  })
})

describe('normalizeTagName', () => {
  it('accepts and normalizes', () => {
    expect(normalizeTagName(' #Foo ')).toBe('foo')
    expect(normalizeTagName('a-b_c')).toBe('a-b_c')
  })
  it('rejects invalid', () => {
    for (const bad of ['', '#', 'a b', '123', 'a.b', 'a#b']) expect(normalizeTagName(bad)).toBeNull()
  })
})

describe('renameTagInText', () => {
  it('renames every occurrence, case-insensitively, only whole tags', () => {
    const src = '#Work and #work, #workshop, `#work`, #work\n```\n#work\n```'
    expect(renameTagInText(src, 'work', 'job')).toBe('#job and #job, #workshop, `#work`, #job\n```\n#work\n```')
  })
  it('handles different lengths and unicode', () => {
    expect(renameTagInText('x #a y #a', 'a', 'longer')).toBe('x #longer y #longer')
    expect(renameTagInText('#żółć #b', 'żółć', 'z')).toBe('#z #b')
  })
  it('leaves text without the tag untouched', () => {
    expect(renameTagInText('#a', 'b', 'c')).toBe('#a')
  })
})

describe('autocomplete', () => {
  it('detects the token before the caret', () => {
    expect(activeTagToken('hi #wo', 6)).toEqual({ start: 3, prefix: 'wo' })
    expect(activeTagToken('#', 1)).toEqual({ start: 0, prefix: '' })
    expect(activeTagToken('hi #wo', 4)).toEqual({ start: 3, prefix: '' })
  })
  it('does not trigger for headings, words, urls or code', () => {
    expect(activeTagToken('# ', 2)).toBeNull()
    expect(activeTagToken('a#b', 3)).toBeNull()
    expect(activeTagToken('http://x/#fr', 12)).toBeNull()
    expect(activeTagToken('```\n#wo', 7)).toBeNull()
    expect(activeTagToken('#wo ', 4)).toBeNull()
  })
  const counts = [{ tag: 'work', count: 1 }, { tag: 'web', count: 3 }, { tag: 'home', count: 2 }]
  it('suggests by prefix, most used first', () => {
    expect(suggestTags('w', counts)).toEqual(['web', 'work'])
    expect(suggestTags('', counts)).toEqual(['web', 'home', 'work'])
    expect(suggestTags('W', counts)).toEqual(['web', 'work'])
    expect(suggestTags('x', counts)).toEqual([])
  })
  it('inserts the chosen tag', () => {
    const t = 'a #wo'
    const r = applySuggestion(t, 5, activeTagToken(t, 5)!, 'work')
    expect(r).toEqual({ text: 'a #work ', caret: 8 })
  })
  it('replaces the rest of the word and does not double the space', () => {
    const t = '#wo rk more'
    expect(applySuggestion(t, 3, activeTagToken(t, 3)!, 'work')).toEqual({ text: '#work rk more', caret: 5 })
    const t2 = '#wrk x'
    expect(applySuggestion(t2, 2, activeTagToken(t2, 2)!, 'work')).toEqual({ text: '#work x', caret: 5 })
  })
})
