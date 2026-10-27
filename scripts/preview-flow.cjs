/**
 * Static preview of the roadmap views, for geometry checks in a real browser.
 *
 * The plugin runs inside the DSH shell (React, its slot geometry, its data),
 * which a plain page cannot reproduce. This script does the next best thing:
 * it loads lib/client.js with the same mock React the render probe uses, runs
 * the REAL components against the LIVE /state payload, serialises the element
 * tree to HTML, and writes a page that carries the plugin's own CSS. Opening it
 * lets a browser (or browser_eval) measure the result: card widths, rail and
 * tick alignment, overflow, and whether the two forms differ at 300px and 900px.
 *
 *   node scripts/preview-flow.cjs [--port=NNNN]
 */
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..')
const OUT = path.join(REPO, 'docs/preview-flow.html')
const source = fs.readFileSync(path.join(REPO, 'lib/client.js'), 'utf8')
  .replace('return module.exports', 'exports.__test = { CSS_TEXT, RoadmapFlow, RoadmapMap, DetailDock, ScopeDriftSide, enrichRoadmap }; return module.exports')

let factory = null
const sandboxWindow = { __ModuleLoader__: { load: options => { factory = options.factory } } }
const sandbox = { window: sandboxWindow, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {} }
sandbox.navigator = {}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

const mockReact = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    // Real React folds extra args into props.children before the component
    // runs; function components destructure it. The mock must do the same or
    // every `function X({ children })` sees undefined.
    const merged = { ...(props ?? {}) }
    if (children.length > 0) merged.children = children.length === 1 ? children[0] : children
    return { type, props: merged, children: merged.children }
  },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useEffect() { return undefined },
  useLayoutEffect() { return undefined },
  useMemo(fn) { return fn() },
  useRef(value) { return { current: value } },
}

const api = factory(() => mockReact).__test
const CSS_TEXT = api.CSS_TEXT

const escapeHtml = text => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** React element tree → HTML with inline styles (class names preserved). */
function toHtml(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (Array.isArray(node)) return node.map(toHtml).join('')
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node)
  if (typeof node.type === 'function') return toHtml(node.type(node.props))
  if (node.type === 'Fragment' || node.type === mockReact.Fragment) return toHtml(node.children)
  const props = node.props ?? {}
  let attrs = ''
  if (typeof props.className === 'string') attrs += ` class="${escapeHtml(props.className)}"`
  if (props.style !== undefined && props.style !== null) {
    const unitless = new Set(['zoom', 'opacity', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'zIndex', 'order', 'strokeWidth', 'strokeOpacity'])
    const css = Object.entries(props.style)
      .map(([key, value]) => {
        const cssKey = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
        const cssValue = typeof value === 'number' && !unitless.has(key) ? `${value}px` : value
        return `${cssKey}:${cssValue}`
      })
      .join(';')
    attrs += ` style="${escapeHtml(css)}"`
  }
  for (const key of ['title', 'aria-label', 'aria-pressed', 'aria-expanded', 'role', 'data-selected', 'data-done', 'data-gnode', 'data-current', 'data-dragging', 'width', 'height', 'viewBox', 'd']) {
    if (props[key] !== undefined) attrs += ` ${key}="${escapeHtml(props[key])}"`
  }
  return `<${node.type}${attrs}>${toHtml(node.children)}</${node.type}>`
}

async function main() {
  // The desktop shell picks a new port on many restarts: auto-discover its
  // listening TCP port instead of growing a hardcoded list forever.
  const portFlag = process.argv.find(arg => /^--port=\d+$/.test(arg))
  const autoPorts = []
  if (process.argv[2] === undefined && portFlag === undefined && process.env.MAINLINE_STATE_URL === undefined) {
    try {
      const { execSync } = require('node:child_process')
      const shellPids = execSync(
        "powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='DeepSeek Harness.exe'\\\" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -ExpandProperty ProcessId\"",
        { encoding: 'utf8' },
      ).split(/\s+/).filter(Boolean)
      for (const line of execSync('netstat -ano -p tcp', { encoding: 'utf8' }).split(/\r?\n/)) {
        const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/)
        if (match !== null && shellPids.includes(match[2])) autoPorts.push(`http://127.0.0.1:${match[1]}`)
      }
    } catch {
      /* best-effort; the hardcoded fallbacks below still apply */
    }
  }
  const bases = [
    process.argv[2],
    portFlag === undefined ? undefined : `http://127.0.0.1:${portFlag.slice('--port='.length)}`,
    process.env.MAINLINE_STATE_URL,
    ...autoPorts,
    'http://127.0.0.1:51252',
    'http://127.0.0.1:52445',
    'http://127.0.0.1:56937',
    'http://127.0.0.1:49156',
    'http://127.0.0.1:58856',
    'http://127.0.0.1:63743',
    'http://127.0.0.1:19387',
  ].filter(Boolean).map(url => url.replace(/\/state\/?$/, '').replace(/\/$/, ''))
  let state = null
  for (const base of [...new Set(bases)]) {
    try {
      const response = await fetch(`${base}/dsh-mainline/state`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(3000) })
      if (!response.ok) continue
      state = await response.json()
      break
    } catch { /* next port */ }
  }
  if (state === null) {
    console.log('no /dsh-mainline/state reachable')
    process.exit(1)
  }
  const document_ = api.enrichRoadmap(state.config.document)
  const alerts = state.alerts
  const current = state.current
  const mapProps = { document_, alerts, current, now: Date.now() }
  const flow = toHtml(api.RoadmapFlow({
    document_, current, collapsedSet: new Set(), toggleFold: () => {}, selected: null, onSelect: () => {},
  }))
  const tree = toHtml(api.RoadmapMap(mapProps))
  // The dock in both states, as the sidebar mounts it (closed) and expanded.
  // It must go through createElement (as the panel does) so the child lands in
  // props.children — calling DetailDock directly would leave children undefined.
  const dockClosed = toHtml(mockReact.createElement(api.DetailDock, {
    health: state.health, alerts, view: state, open: false, onToggle: () => {}, tab: 'alerts', onTab: () => {},
  }))
  const dockOpen = toHtml(mockReact.createElement(api.DetailDock, {
    health: state.health, alerts, view: state, open: true, onToggle: () => {}, tab: 'alerts', onTab: () => {},
  }, { type: 'div', props: { className: 'sd-card', style: { height: 120 } }, children: [{ type: 'div', props: { className: 'sd-empty' }, children: '预览用占位明细' }] }))

  const page = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>mainline preview</title>
<style>
html, body { margin: 0; background: #16181d; color: #e6e8ee; font-family: "Microsoft YaHei UI", system-ui, sans-serif; }
body { padding: 16px; display: flex; gap: 20px; align-items: flex-start; }
.col { flex: 0 0 auto; border: 1px solid #2b2f38; border-radius: 10px; padding: 10px; }
.col[data-w="side"] { width: 360px; }
.col[data-w="main"] { width: 900px; }
h2 { font-size: 12px; margin: 0 0 8px; opacity: .7; font-weight: 600; }
${CSS_TEXT}
</style></head><body>
<div class="col" data-w="side"><h2>右侧栏 · 300px</h2><div class="sd-root sd-side">${flow}</div></div>
<div class="col" data-w="main"><h2>主面板 · 900px</h2><div class="sd-root">${flow}</div></div>
<div class="col" data-w="main"><h2>树状图 · 900px</h2><div class="sd-root">${tree}</div></div>
<div class="col" data-w="side"><h2>底栏 · 收起</h2>
  <div class="sd-root sd-side" style="height:420px; display:flex; flex-direction:column;">
    <div class="sd-scroll" style="flex:1; min-height:0;">${tree}</div>
    ${dockClosed}
  </div></div>
<div class="col" data-w="side"><h2>底栏 · 展开</h2>
  <div class="sd-root sd-side" style="height:420px; display:flex; flex-direction:column;">
    <div class="sd-scroll" style="flex:1; min-height:0;">${tree}</div>
    ${dockOpen}
  </div></div>
<script>
// The panel fits its canvas on mount (an effect, which the mock renderer does
// not run). Re-apply the same arithmetic here so the page shows what the panel
// shows: height-preferred scale (width may spill 15%), clamped to 0.78..1.4.
for (const graph of document.querySelectorAll('.sd-graph')) {
  const inner = graph.querySelector('.sd-graph-inner')
  if (inner === null) continue
  const W = inner.offsetWidth
  const H = inner.offsetHeight
  const cw = graph.clientWidth
  const ch = graph.clientHeight
  const kHeight = (ch - 48) / Math.max(1, H)
  const kWidth = (cw - 48) / Math.max(1, W)
  const k = Math.min(1.4, Math.max(0.78, Math.min(kHeight, kWidth * 1.15)))
  const x = Math.round((cw - W * k) / 2)
  const y = H * k > ch ? 0 : Math.round((ch - H * k) / 2)
  inner.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + k + ')'
  inner.dataset.fit = k.toFixed(3)
  graph.dataset.fit = k.toFixed(3)
}
</script>
</body></html>`
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, page, 'utf8')
  console.log(`wrote ${OUT} (${page.length} bytes)`)
}

main().catch(error => { console.log('ERROR', error.stack); process.exit(1) })
