export type Kind =
  | 'mermaid' | 'svg' | 'html' | 'math' | 'vega' | 'vega-lite' | 'chartjs' | 'dot' | 'd2' | 'plantuml' | 'image' | 'video'
export type Diagram = { kind: Kind; source: string; raw: string; key: string }
export type Part = string | Diagram

const LANGUAGES: Record<string, Kind> = {
  mermaid: 'mermaid',
  svg: 'svg',
  math: 'math',
  latex: 'math',
  tex: 'math',
  vega: 'vega',
  'vega-lite': 'vega-lite',
  vegalite: 'vega-lite',
  chartjs: 'chartjs',
  dot: 'dot',
  graphviz: 'dot',
  d2: 'd2',
  plantuml: 'plantuml',
  puml: 'plantuml',
}

// A fence of any language, so a diagram quoted inside one stays text, or an image alone on its line.
const BLOCK =
  /^(`{3,})([\w-]+)([ \t]+render)?[ \t]*\n([\s\S]*?)\n\1[ \t]*$|^!\[[^\]\n]*\]\((\/[^)\s]+\.(png|jpe?g|webp|gif|mp4|mov|webm))\)[ \t]*$/gim

// cyrb53: file names for the cache only, not a security boundary.
const hash = (text: string) => {
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 2654435761)
    b = Math.imul(b ^ c, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36)
}

const kindOf = (language: string, marked: boolean): Kind | undefined =>
  // HTML is everyday code to read, so it draws only when marked `html render`.
  language === 'html' ? (marked ? 'html' : undefined) : LANGUAGES[language]

/** Splits markdown around closed diagram blocks; a block still streaming stays text. */
export const split = (text: string): Part[] => {
  const parts: Part[] = []
  let at = 0
  for (const m of text.matchAll(BLOCK)) {
    const [raw, ticks, language, marked, body, path, extension] = m
    const kind = path
      ? /gif|mp4|mov|webm/i.test(extension as string) ? 'video' : 'image'
      : ticks === '```' ? kindOf((language as string).toLowerCase(), Boolean(marked)) : undefined
    if (!kind) {
      continue
    }
    const source = path ?? (body as string)
    parts.push(text.slice(at, m.index), { kind, source, raw, key: `${kind}-${hash(source)}` })
    at = m.index + raw.length
  }
  parts.push(text.slice(at))
  return parts
}

/** Cells for a picture drawn at twice its size: a cell is about 8 by 18 of those pixels' halves. */
export const fit = (width: number, height: number, available: number) => {
  const maxRows = 30
  let columns = Math.max(1, Math.min(available, 120, Math.ceil(width / 16)))
  let rows = Math.round((columns * height * 0.45) / width)
  if (rows > maxRows) {
    rows = maxRows
    columns = Math.max(1, Math.round((rows * width) / (height * 0.45)))
  }
  return { columns, rows: Math.max(1, rows) }
}

/** Width and height from a PNG's IHDR. */
export const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
