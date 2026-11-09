import { describe, expect, it } from 'vitest'
import {
  applySuggestion, extractTags, filterByTag, getTagTrigger, normalizeTagName, renameTag, suggestTags, tagCounts,
} from './tags'

describe('extractTags', () => {
  it('finds tags anywhere, lowercased and de-duplicated', () => {
    expect(extractTags('Plan #Work today\nand #home, #work again. (#to-do) #a/b')).toEqual(['work', 'home', 'to-do', 'a/b'])
  })
  it('finds a tag at the very start of the text or a line', () => {
    expect(extractTags('#first\n#second')).toEqual(['first', 'second'])
  })
  it('does not treat headings as tags', () => {
    expect(extractTags('# Title\n## Sub\n###### six')).toEqual([])
  })
  it('ignores code, URL fragments, entities, numbers and glued words', () => {
    expect(extractTags('`#inline`\n```\n#fenced\n```\n[x](http://a.com/#frag) http://b.com/#f &#39; #123 abc#def')).toEqual([])
  })
  it('handles unicode', () => {
    expect(extractTags('#café #日本')).toEqual(['café', '日本'])
  })
  it('does not swallow trailing punctuation', () => {
    expect(extractTags('#done. #next-')).toEqual(['done', 'next'])
  })
})

describe('tagCounts / filterByTag', () => {
  const notes = [
    { content: '#b #a #a' }, { content: 'x #a' }, { content: 'none' },
  ]
  it('counts notes (not occurrences), sorted by name', () => {
    expect(tagCounts(notes)).toEqual([{ name: 'a', count: 2 }, { name: 'b', count: 1 }])
  })
  it('filters, and null clears the filter', () => {
    expect(filterByTag(notes, 'b')).toEqual([notes[0]])
    expect(filterByTag(notes, 'a')).toHaveLength(2)
    expect(filterByTag(notes, null)).toBe(notes)
  })
})

describe('renameTag', () => {
  it('renames every occurrence case-insensitively, leaving others alone', () => {
    const src = '#Work and #work, #workshop, `#work`\n```\n#work\n```\n# Work'
    expect(renameTag(src, 'work', 'job')).toBe('#job and #job, #workshop, `#work`\n```\n#work\n```\n# Work')
  })
  it('is a no-op when absent', () => {
    expect(renameTag('hi #a', 'b', 'c')).toBe('hi #a')
  })
  it('merges into an existing tag', () => {
    expect(extractTags(renameTag('#a #b', 'a', 'b'))).toEqual(['b'])
  })
})

describe('normalizeTagName', () => {
  it('accepts valid names and strips #', () => {
    expect(normalizeTagName(' #Work ')).toBe('work')
    expect(normalizeTagName('to-do')).toBe('to-do')
  })
  it('rejects invalid names', () => {
    for (const bad of ['', '#', 'a b', 'a#b', '123', '-x', 'x-', 'a!']) expect(normalizeTagName(bad)).toBeNull()
  })
})

describe('suggestions', () => {
  it('detects a trigger before the caret', () => {
    expect(getTagTrigger('hello #wo', 9)).toEqual({ start: 6, query: 'wo' })
    expect(getTagTrigger('#', 1)).toEqual({ start: 0, query: '' })
    expect(getTagTrigger('a\n#Wo', 5)).toEqual({ start: 2, query: 'wo' })
  })
  it('does not trigger in headings, code, words or after a space', () => {
    expect(getTagTrigger('# ', 2)).toBeNull()
    expect(getTagTrigger('abc#de', 6)).toBeNull()
    expect(getTagTrigger('#ab ', 4)).toBeNull()
    expect(getTagTrigger('```\n#ab', 7)).toBeNull()
    expect(getTagTrigger('`#ab', 4)).toBeNull()
  })
  it('suggests by prefix, excluding an exact match', () => {
    const all = ['home', 'work', 'workout', 'wo']
    expect(suggestTags(all, '')).toEqual(all)
    expect(suggestTags(all, 'wo')).toEqual(['work', 'workout'])
    expect(suggestTags(all, 'x')).toEqual([])
    expect(suggestTags(all, '', 2)).toHaveLength(2)
  })
  it('inserts the chosen tag and moves the caret after it', () => {
    const r = applySuggestion('see #wo now', { start: 4, query: 'wo' }, 7, 'work')
    expect(r).toEqual({ text: 'see #work  now', caret: 10 })
  })
})
