import type { Register } from 'claude-code'

import { fit, pngSize, split } from './diagram'
import type { Diagram } from './diagram'

const MAX_PNG = 2 * 1024 * 1024
const FRAME_MS = 100
const LOOPS = 3

const PROMPT = `In this terminal, these fenced code blocks in your replies are drawn as pictures: mermaid, svg, math (LaTeX), vega-lite, vega, chartjs (Chart.js config as JSON), dot, d2, plantuml, and \`html render\` (static HTML, no scripts, no network). A local file alone on its line as ![alt](/absolute/path) is shown too: png, jpg, webp, gif, mp4, mov, webm. Use one when a picture says it better than text. A plain \`html\` block stays code.`

// In the hooks environment, newer than the es2023 lib the mod's types are checked against.
const decode = (Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }).fromBase64

type Picture = { png: string; width: number; height: number; frames?: string[] }

export const register: Register = on => {
  const pictures = new Map<string, Picture>()
  const failed = new Set<string>()
  const running = new Set<string>()
  const playing = new Set<string>()
  let cache: string | undefined

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'diagram-view:blocks', text: PROMPT, scope: 'session' }] }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary) {
      return next(e)
    }
    const parts = split(e.props.text)
    if (parts.length === 1) {
      return next(e)
    }

    const renderer = `${$.plugin.root}/renderer/render.mjs`
    const cacheDir = async () => {
      cache ??= (await $.process.run(['node', renderer, '--cache-dir'])).stdout
      return cache
    }

    const load = async (kind: Diagram['kind'], path: string, key: string) => {
      const frames =
        kind === 'video'
          ? (await $.fs.list(path)).map(entry => `${path}/${entry.name}`).sort()
          : undefined
      const first = frames?.[0] ?? path
      if ((await $.fs.stat(first)).size > MAX_PNG) {
        failed.add(key)
        return
      }
      const { base64 } = await $.fs.read(first, { as: 'bytes' })
      pictures.set(key, { png: base64, ...pngSize(decode(base64)), frames })
    }

    const convert = async ({ kind, source }: Diagram, key: string, output: string) => {
      const isFile = kind === 'image' || kind === 'video'
      const input = isFile ? source : `${await cacheDir()}/${key}.src`
      if (!isFile) {
        await $.fs.write(input, source)
      }
      const { exitCode, stderr } = await $.process.run(['node', renderer, kind, input, output], { timeoutMs: 60_000 })
      if (exitCode !== 0) {
        throw new Error(stderr)
      }
      await load(kind, output, key)
    }

    // A local file's key follows its mtime, so a rewritten file draws anew.
    const keyOf = async (d: Diagram) => {
      if (d.kind !== 'image' && d.kind !== 'video') {
        return d.key
      }
      return $.fs.stat(d.source).then(
        ({ mtimeMs }) => `${d.key}-${mtimeMs}`,
        () => undefined,
      )
    }

    const draw = async (d: Diagram, key: string) => {
      if (pictures.has(key) || failed.has(key) || running.has(key)) {
        return
      }
      const output = `${await cacheDir()}/${key}${d.kind === 'video' ? '' : '.png'}`
      if (await $.fs.exists(output)) {
        await load(d.kind, output, key)
        return
      }
      running.add(key)
      $.clock.after(0, () => {
        convert(d, key, output)
          .catch(error => {
            failed.add(key)
            $.ui.toast(`diagram-view: ${d.kind}: ${String(error).slice(0, 160)}`)
          })
          .finally(() => {
            running.delete(key)
            $.ui.invalidate('ui.render')
          })
      })
    }

    const play = (key: string, frames: string[]) => {
      const site = `${e.requestId}:${key}`
      if (playing.has(site)) {
        return
      }
      playing.add(site)
      let tick = 0
      const step = async () => {
        const path = frames[tick % frames.length] as string
        const { base64 } = await $.fs.read(path, { as: 'bytes' })
        const result = await $.ui.blit({ requestId: e.requestId, key, source: { png: base64 } })
        tick += 1
        if (!('deny' in result) && tick < frames.length * LOOPS) {
          $.clock.after(FRAME_MS, () => void step().catch(() => undefined))
        }
      }
      $.clock.after(500, () => void step().catch(() => undefined))
    }

    const keys = new Map<Diagram, string | undefined>()
    for (const part of parts) {
      if (typeof part !== 'string') {
        const key = await keyOf(part)
        keys.set(part, key)
        if (key) {
          await draw(part, key)
        }
      }
    }

    const shown = (part: Diagram) => {
      const key = keys.get(part)
      const picture = key === undefined ? undefined : pictures.get(key)
      return key && picture ? { ...picture, key } : undefined
    }
    if (![...keys.keys()].some(shown)) {
      return next(e)
    }

    // Text between pictures: a block with no picture yet stays its raw text.
    const blocks: (string | (Picture & { key: string }))[] = ['']
    for (const part of parts) {
      const picture = typeof part === 'string' ? undefined : shown(part)
      if (picture) {
        blocks.push(picture, '')
      } else {
        blocks[blocks.length - 1] += typeof part === 'string' ? part : part.raw
      }
    }

    const { Box, Image, Markdown } = $.ui.resolve(e)
    const available = (e.viewport?.columns ?? 80) - 2
    const [head, ...rest] = blocks
    const opening = await next({ ...e, props: { ...e.props, text: (head as string).trim() || 'Diagram' } })

    return (
      <Box flexDirection="column">
        {opening}
        {rest.map((block, i) => {
          if (typeof block === 'string') {
            return block.trim() ? (
              <Box key={`text-${i}`} marginLeft={2}>
                <Markdown text={block.trim()} />
              </Box>
            ) : null
          }
          if (block.frames) {
            play(block.key, block.frames)
          }
          // Frames are stored at half the size of the other pictures.
          const scale = block.frames ? 2 : 1
          return (
            <Box key={block.key} marginLeft={2} marginTop={1}>
              <Image
                key={block.key}
                source={{ png: block.png }}
                alt={`[diagram ${block.key}]`}
                {...fit(block.width * scale, block.height * scale, available)}
              />
            </Box>
          )
        })}
      </Box>
    )
  })
}
