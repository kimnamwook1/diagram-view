import { expect, test } from 'claude-code/testing'

import { fit, pngSize, split } from '../hooks/diagram'

test('splits text around closed mermaid and svg fences', () => {
  const parts = split('before\n```mermaid\ngraph TD; A-->B\n```\nmid\n```svg\n<svg/>\n```\nafter')
  expect(parts).toHaveLength(5)
  expect(parts[0]).toBe('before\n')
  expect(parts[1]).toMatchObject({ kind: 'mermaid', source: 'graph TD; A-->B' })
  expect(parts[3]).toMatchObject({ kind: 'svg', source: '<svg/>' })
  expect(parts[4]).toBe('\nafter')
})

test('leaves plain text, other languages and unclosed fences alone', () => {
  expect(split('hello')).toEqual(['hello'])
  expect(split('```ts\nconst a = 1\n```')).toHaveLength(1)
  expect(split('```mermaid\ngraph TD; A-->B')).toHaveLength(1)
})

test('same source gets the same key, different source another', () => {
  const key = (s: string) => (split('```svg\n' + s + '\n```')[1] as { key: string }).key
  expect(key('<a/>')).toBe(key('<a/>'))
  expect(key('<a/>')).not.toBe(key('<b/>'))
})

test('fit keeps the aspect ratio inside the width and height caps', () => {
  expect(fit(1600, 800, 200)).toEqual({ columns: 100, rows: 23 })
  expect(fit(1600, 800, 40)).toEqual({ columns: 40, rows: 9 })
  expect(fit(400, 4000, 100)).toEqual({ columns: 7, rows: 30 })
})

test('reads the size from a PNG header', () => {
  const bytes = new Uint8Array(24)
  new DataView(bytes.buffer).setUint32(16, 640)
  new DataView(bytes.buffer).setUint32(20, 480)
  expect(pngSize(bytes)).toEqual({ width: 640, height: 480 })
})

test('knows every fence language and its aliases', () => {
  const kind = (fence: string) => (split('```' + fence + '\nx\n```')[1] as { kind: string } | undefined)?.kind
  expect(kind('latex')).toBe('math')
  expect(kind('graphviz')).toBe('dot')
  expect(kind('puml')).toBe('plantuml')
  expect(kind('vegalite')).toBe('vega-lite')
  expect(kind('chartjs')).toBe('chartjs')
  expect(kind('d2')).toBe('d2')
})

test('html draws only when marked render', () => {
  expect(split('```html\n<b>x</b>\n```')).toHaveLength(1)
  expect(split('```html render\n<b>x</b>\n```')[1]).toMatchObject({ kind: 'html', source: '<b>x</b>' })
})

test('a local image or video alone on its line is a block, a remote or inline one is not', () => {
  expect(split('![a](/tmp/a.png)')[1]).toMatchObject({ kind: 'image', source: '/tmp/a.png' })
  expect(split('![a](/tmp/a.gif)')[1]).toMatchObject({ kind: 'video' })
  expect(split('![a](/tmp/a.MP4)')[1]).toMatchObject({ kind: 'video' })
  expect(split('![a](https://x.io/a.png)')).toHaveLength(1)
  expect(split('see ![a](/tmp/a.png) here')).toHaveLength(1)
})

test('a diagram fence quoted inside another fence stays text', () => {
  expect(split('````md\n```mermaid\ngraph TD\n```\n````')).toHaveLength(1)
})
