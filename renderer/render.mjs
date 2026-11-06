#!/usr/bin/env node
// Turns one diagram source into a PNG: render.mjs <kind> <input> <output>.
// `video` writes numbered frames into <output>, a folder. `--cache-dir` prints where pictures live.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const VENDOR = join(HERE, '..', 'vendor')
const HINTS = {
  mmdc: 'npm i -g @mermaid-js/mermaid-cli',
  resvg: 'brew install resvg',
  dot: 'brew install graphviz',
  d2: 'brew install d2',
  plantuml: 'brew install plantuml',
  ffmpeg: 'brew install ffmpeg',
}
const CHROMES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
const chromePath = () => {
  const found = CHROMES.find(path => path && existsSync(path))
  if (!found) throw new Error('Chrome not found: install it or set CHROME_PATH')
  return found
}

const run = (argv, { stdin, env } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('error', error =>
      reject(error.code === 'ENOENT' ? new Error(`${argv[0]} not found: ${HINTS[argv[0]] ?? 'install it'}`) : error),
    )
    child.on('close', code => (code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${argv[0]} exited ${code}`))))
    child.stdin.end(stdin)
  })

const PAGE = `<!doctype html><meta charset="utf-8"><style>
body{display:inline-block;margin:0;padding:12px;background:#fff;color:#111;font-family:-apple-system,"Apple SD Gothic Neo",sans-serif}
</style>`

const inline = file => readFileSync(join(VENDOR, file), 'utf8').replaceAll('</script', '<\\/script')
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c')

/** Draws a page in headless Chrome, offline, on about:blank so it reaches no local file. */
const shoot = async (html, output, { scripts }) => {
  const profile = mkdtempSync(join(tmpdir(), 'diagram-view-chrome-'))
  const chrome = spawn(chromePath(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  try {
    const port = await new Promise((resolve, reject) => {
      let log = ''
      chrome.on('error', reject)
      chrome.stderr.on('data', chunk => {
        log += chunk
        const match = log.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//)
        if (match) resolve(match[1])
      })
    })
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = () => reject(new Error('could not reach Chrome'))
    })
    const pending = new Map()
    let id = 0
    socket.onmessage = ({ data }) => {
      const reply = JSON.parse(data)
      const waiter = pending.get(reply.id)
      if (!waiter) return
      pending.delete(reply.id)
      reply.error ? waiter.reject(new Error(reply.error.message)) : waiter.resolve(reply.result)
    }
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })

    await send('Page.enable')
    await send('Network.enable')
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await send('Emulation.setScriptExecutionDisabled', { value: !scripts })
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 2, mobile: false })
    const { frameTree } = await send('Page.getFrameTree')
    await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html })
    if (scripts) {
      const { exceptionDetails } = await send('Runtime.evaluate', {
        expression: 'Promise.resolve(window.__ready).then(() => document.fonts.ready).then(() => 1)',
        awaitPromise: true,
      })
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    }
    const { root } = await send('DOM.getDocument')
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'body' })
    const { model } = await send('DOM.getBoxModel', { nodeId })
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: model.width, height: model.height, scale: 1 },
    })
    writeFileSync(output, Buffer.from(data, 'base64'))
    socket.close()
  } finally {
    chrome.kill('SIGKILL')
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
  }
}

const katexCss = () =>
  inline('katex.min.css').replace(/url\(fonts\/([^)]+\.woff2)\)/g, (_, font) =>
    `url(data:font/woff2;base64,${readFileSync(join(VENDOR, 'fonts', font)).toString('base64')})`,
  )

const scripted = (body, ...libraries) =>
  `${PAGE}<body>${body}${libraries.map(file => `<script>${inline(file)}</script>`).join('')}`

const pages = {
  math: source =>
    `${PAGE}<style>${katexCss()}</style><body><div id="out"></div><script>${inline('katex.min.js')}</script>` +
    `<script>window.__ready = (async () => katex.render(${json(source)}, document.getElementById('out'), { displayMode: true, throwOnError: true }))()</script>`,
  vega: (source, compile) =>
    scripted('', 'vega.min.js', ...(compile ? ['vega-lite.min.js'] : [])) +
    `<script>window.__ready = (async () => {
      const spec = ${json(JSON.parse(source))}
      const view = new vega.View(vega.parse(${compile ? 'vegaLite.compile(spec).spec' : 'spec'}), { renderer: 'none' })
      document.body.innerHTML = await view.toSVG()
    })()</script>`,
  chartjs: source =>
    scripted('<canvas id="out" width="800" height="400"></canvas>', 'chart.umd.min.js') +
    `<script>window.__ready = (async () => {
      const spec = ${json(JSON.parse(source))}
      new Chart(document.getElementById('out'), { ...spec, options: { ...spec.options, animation: false, responsive: false } })
    })()</script>`,
}

// A root svg with a viewBox alone has no size of its own inside an inline-block body.
const svgPage = svg => {
  const box = svg.match(/<svg[^>]*?viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/)
  const sized = box && !/<svg[^>]*?\swidth=/.test(svg.slice(0, box.index + box[0].length))
  return `${PAGE}<body>${sized ? svg.replace('<svg', `<svg width="${box[1]}" height="${box[2]}"`) : svg}`
}
const read = path => readFileSync(path, 'utf8')

const renderers = {
  mermaid: (input, output) =>
    // puppeteer.json points Chrome at a dead proxy: a label's image must not reach the network.
    run(['mmdc', '-q', '-p', join(HERE, 'puppeteer.json'), '-i', input, '-o', output, '-t', 'dark', '-b', 'transparent', '-s', '2'], {
      env: { PUPPETEER_EXECUTABLE_PATH: chromePath() },
    }),
  svg: (input, output) => run(['resvg', '--background', 'white', '--zoom', '2', input, output]),
  html: (input, output) => shoot(PAGE + read(input), output, { scripts: false }),
  math: (input, output) => shoot(pages.math(read(input)), output, { scripts: true }),
  vega: (input, output) => shoot(pages.vega(read(input), false), output, { scripts: true }),
  'vega-lite': (input, output) => shoot(pages.vega(read(input), true), output, { scripts: true }),
  chartjs: (input, output) => shoot(pages.chartjs(read(input)), output, { scripts: true }),
  dot: async (input, output) => shoot(svgPage(await run(['dot', '-Tsvg', input])), output, { scripts: false }),
  d2: async (input, output) => {
    // Bundling would fetch remote icons; the offline page drops them instead.
    await run(['d2', '--bundle=false', input, `${output}.svg`])
    await shoot(svgPage(read(`${output}.svg`)), output, { scripts: false })
  },
  plantuml: async (input, output) => {
    const source = read(input)
    const stdin = source.includes('@start') ? source : `@startuml\n${source}\n@enduml`
    const svg = await run(['plantuml', '-tsvg', '-pipe'], {
      stdin,
      env: { PLANTUML_SECURITY_PROFILE: 'SANDBOX', JAVA_TOOL_OPTIONS: '-Djava.awt.headless=true' },
    })
    await shoot(svgPage(svg), output, { scripts: false })
  },
  image: (input, output) =>
    run(['ffmpeg', '-v', 'error', '-y', '-protocol_whitelist', 'file', '-i', input, '-frames:v', '1', '-vf', "scale='min(1600,iw)':-2", output]),
  video: async (input, output) => {
    mkdirSync(output, { recursive: true })
    await run(['ffmpeg', '-v', 'error', '-y', '-protocol_whitelist', 'file', '-i', input, '-t', '20', '-vf', "fps=10,scale='min(640,iw)':-2", join(output, '%04d.png')])
    if (readdirSync(output).length === 0) throw new Error('no frames')
  },
}

const [kind, input, output] = process.argv.slice(2)
if (kind === '--cache-dir') {
  const cache = join(tmpdir(), 'diagram-view')
  mkdirSync(cache, { recursive: true, mode: 0o700 })
  if (statSync(cache).uid !== process.getuid()) throw new Error(`${cache} belongs to another user`)
  process.stdout.write(cache)
} else {
  await renderers[kind](input, output).catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
process.exit(0)
