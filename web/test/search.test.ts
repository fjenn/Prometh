import { test } from 'node:test'
import assert from 'node:assert/strict'
import { citedLinks, indexedHits, needsWeb, preferDistinctDomains, promptNote, searchQuery } from '../src/engine/search.ts'
const result = (url: string) => ({ url, title: url, snippet: 'snippet is not a fetched source' })
test('selection prefers article URLs and distinct normalized hosts, preserving order', () => {
  const picked = preferDistinctDomains(['https://a.org/', 'https://www.a.org/article', 'https://a.org/other', 'https://b.org/post', 'https://news.google.com/topstories', 'https://c.org/report', 'bad'].map(result))
  assert.deepEqual(picked.map((p) => p.url), ['https://www.a.org/article', 'https://b.org/post', 'https://c.org/report'])
})
test('only successful reads become numbered sources; redirect URL and title are retained', () => {
  const selected = ['https://a.org/a', 'https://b.org/b', 'https://c.org/c'].map(result)
  const hits = indexedHits(selected, new Map([['https://b.org/b', { title: 'Article', text: 'read text', url: 'https://b.org/final' }], ['https://c.org/c', { text: ' ' }]]))
  assert.deepEqual(hits, [{ index: 1, title: 'Article', url: 'https://b.org/final', body: 'read text' }])
  assert.equal(indexedHits(selected, new Map([['https://a.org/a', { text: 'yes' }]]), 3)[0].index, 4)
  assert.ok(!promptNote(hits).includes('snippet is not'))
  assert.match(promptNote([]), /No sources/)
})
test('search excerpts have a fixed total context budget', () => {
  const hits = [1, 2, 3].map((index) => ({ index, title: 'title', url: 'https://a.org/' + index, body: 'word '.repeat(10000) }))
  const note = promptNote(hits)
  assert.ok(note.length <= 3600, String(note.length))
  for (const hit of hits) assert.ok(note.includes(`[${hit.index}] title`))
})
test('search note starts with the only numbered sources and requires citations after each sourced fact', () => {
  const hits = [4, 5, 6].map((index) => ({ index, title: `Article ${index}`, url: `https://example.org/${index}`, body: 'Fetched facts.' }))
  const note = promptNote(hits)
  assert.ok(note.startsWith('These are the only sources you may cite or name: [4] Article 4; [5] Article 5; [6] Article 6.'))
  assert.match(note, /Cite \[n\] after each sourced fact\./)
  assert.match(note, /State only facts present in the Page text\./)
  assert.ok(note.indexOf('Cite [n]') < note.indexOf('Page text:\n'))
})
test('source instructions and long metadata share the total excerpt budget', () => {
  const hits = [1, 2, 3].map((index) => ({ index, title: 'T'.repeat(1000), url: 'https://example.org/' + 'u'.repeat(2000), body: 'word '.repeat(10000) }))
  const note = promptNote(hits)
  assert.ok(note.length <= 3600, String(note.length))
  assert.match(note, /Cite \[n\] after each sourced fact\./)
  assert.equal(note.split('Page text:\n').length - 1, 3)
})
test('cited links show only valid cited fetched sources, ignoring code and reasoning', () => {
  const sources = [1, 2, 3].map((index) => ({ index, title: 'T', url: 'https://a.org/' + index }))
  assert.deepEqual(citedLinks(sources, '<think>[3]</think>Fact [2][1][2] [99] `code [3]`'), sources.slice(0, 2))
  assert.deepEqual(citedLinks(sources, 'No citations'), [])
  assert.deepEqual(citedLinks(sources, '[3](https://a.org/)'), [])
})
test('cue router uses word boundaries and search query preserves the subject', () => {
  for (const cue of ['news', 'Who won', 'LATEST', 'most recent', 'what happened', 'current events', 'yesterday']) assert.ok(needsWeb(cue))
  assert.ok(!needsWeb('newspaper formatting'))
  assert.ok(!needsWeb('explain recursion'))
  assert.equal(searchQuery('  latest Argentina news  '), 'latest Argentina news')
  assert.equal(searchQuery('x'.repeat(400)).length, 300)
})
