import { describe, expect, it } from 'vitest'
import {
  applySuggestion,
  codeMask,
  countTags,
  extractTags,
  hasTag,
  normalizeTag,
  renameTag,
  suggestTags,
  tagQueryAt,
} from './tags'

describe('extractTags', () => {
  it('finds tags anywhere in the text, lowercased and unique', () => {
    expect(extractTags('#Work stuff and #ideas, also #work again.\n- item #to-do')).toEqual(['work', 'ideas', 'to-do'])
  })

  it('accepts tags at line start, after punctuation and with unicode', () => {
    expect(extractTags('#start\n(#paren) "#quoted" #zażółć #q3_goals')).toEqual([
      'start',
      'paren',
      'quoted',
      'zażółć',
      'q3_goals',
    ])
  })

  it('ignores headings, numbers and hashes glued to words', () => {
    expect(extractTags('# Heading\n## Sub\nissue #123 C# page#anchor a&#39;b ##double')).toEqual([])
  })

  it('trims trailing hyphens and punctuation', () => {
    expect(extractTags('#done. #wip- #a-b-c!')).toEqual(['done', 'wip', 'a-b-c'])
  })

  it('ignores code, link targets, URLs and escaped hashes', () => {
    const md = [
      'Use `#notatag` inline',
      '```',
      '#also-not',
      '```',
      '[link](#anchor) and [#linktext](https://x.com)',
      'https://example.com/page#frag',
      '\\#escaped',
      '#real',
    ].join('\n')
    expect(extractTags(md)).toEqual(['linktext', 'real'])
  })
})

describe('codeMask', () => {
  it('keeps the same length and blanks code', () => {
    const md = 'a `#x` b\n```\n#y\n```\n#z'
    const mask = codeMask(md)
    expect(mask).toHaveLength(md.length)
    expect(mask).not.toContain('#x')
    expect(mask).not.toContain('#y')
    expect(mask).toContain('#z')
  })
})

describe('countTags', () => {
  it('counts notes per tag (not occurrences), sorted alphabetically', () => {
    expect(countTags(['#b #a #a', '#a', 'none', '#c `#b`'])).toEqual([
      { tag: 'a', count: 2 },
      { tag: 'b', count: 1 },
      { tag: 'c', count: 1 },
    ])
  })
  it('hasTag is case-insensitive', () => {
    expect(hasTag('Hello #Work', 'work')).toBe(true)
    expect(hasTag('Hello #Workshop', 'work')).toBe(false)
  })
})

describe('normalizeTag', () => {
  it('cleans and validates names', () => {
    expect(normalizeTag(' #Work ')).toBe('work')
    expect(normalizeTag('to-do')).toBe('to-do')
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('#')).toBeNull()
    expect(normalizeTag('two words')).toBeNull()
    expect(normalizeTag('123')).toBeNull()
    expect(normalizeTag('bad!')).toBeNull()
    expect(normalizeTag('-x')).toBeNull()
  })
})

describe('renameTag', () => {
  it('renames every occurrence, case-insensitively', () => {
    expect(renameTag('#work and #Work. (#WORK)', 'work', 'job')).toBe('#job and #job. (#job)')
  })
  it('only renames whole tags', () => {
    expect(renameTag('#work #workshop #work-items #homework', 'work', 'job')).toBe(
      '#job #workshop #work-items #homework',
    )
  })
  it('leaves code, links and URLs alone', () => {
    const md = '`#work` [x](#work) https://a.com/#work\n```\n#work\n```\n#work'
    expect(renameTag(md, 'work', 'job')).toBe('`#work` [x](#work) https://a.com/#work\n```\n#work\n```\n#job')
  })
  it('normalizes the new name and rejects invalid ones', () => {
    expect(renameTag('#a', 'a', '#New-Name')).toBe('#new-name')
    expect(renameTag('#a', 'a', 'not valid')).toBe('#a')
    expect(renameTag('no tags', 'a', 'b')).toBe('no tags')
  })
  it('can merge into an existing tag', () => {
    expect(extractTags(renameTag('#a #b', 'a', 'b'))).toEqual(['b'])
  })
})

describe('tagQueryAt', () => {
  it('detects a tag being typed at the caret', () => {
    expect(tagQueryAt('hello #wo', 9)).toEqual({ start: 6, end: 9, query: 'wo' })
    expect(tagQueryAt('#', 1)).toEqual({ start: 0, end: 1, query: '' })
    // caret in the middle of a word extends the end
    expect(tagQueryAt('x #work y', 5)).toEqual({ start: 2, end: 7, query: 'wo' })
  })
  it('returns null when not in a tag', () => {
    expect(tagQueryAt('hello wo', 8)).toBeNull()
    expect(tagQueryAt('# heading', 9)).toBeNull()
    expect(tagQueryAt('C#', 2)).toBeNull()
    expect(tagQueryAt('a.com/#x', 8)).toBeNull()
    expect(tagQueryAt('`#code', 6)).toBeNull()
    expect(tagQueryAt('```\n#x', 6)).toBeNull()
  })
})

describe('suggestTags', () => {
  const tags = ['work', 'homework', 'ideas', 'workshop', 'zebra']
  it('lists prefix matches before substring matches', () => {
    expect(suggestTags(tags, 'work')).toEqual(['work', 'workshop', 'homework'])
    expect(suggestTags(tags, 'WO')).toEqual(['work', 'workshop', 'homework'])
  })
  it('lists everything for an empty query, up to the limit', () => {
    expect(suggestTags(tags, '')).toEqual(['homework', 'ideas', 'work', 'workshop', 'zebra'])
    expect(suggestTags(tags, '', 2)).toHaveLength(2)
    expect(suggestTags(tags, 'qq')).toEqual([])
  })
})

describe('applySuggestion', () => {
  it('completes the tag and adds a space', () => {
    const text = 'note #wo'
    const q = tagQueryAt(text, text.length)!
    expect(applySuggestion(text, q, 'work')).toEqual({ text: 'note #work ', caret: 11 })
  })
  it('replaces the whole word and reuses following whitespace', () => {
    const text = 'a #wxyz b'
    const q = tagQueryAt(text, 4)!
    expect(applySuggestion(text, q, 'work')).toEqual({ text: 'a #work b', caret: 7 })
  })
  it('adds a space before following punctuation', () => {
    const text = '(#i)'
    const q = tagQueryAt(text, 3)!
    expect(applySuggestion(text, q, 'ideas')).toEqual({ text: '(#ideas )', caret: 8 })
  })
})
