/**
 * Render-time crash reproduction for the roadmap components.
 *
 * Loads lib/client.js with a stubbed ModuleLoader + mock React (hooks return
 * static values, createElement builds a lazy tree), then WALKS the element
 * tree executing every function component with the REAL /state payload —
 * any ReferenceError/TypeError in a render body throws here with a stack.
 */
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(REPO, 'lib/client.js'), 'utf8')
  .replace('return module.exports', 'exports.__test = { RoadmapMap, RoadmapFlow, ViewSwitch, readViewMode, graphNodes, layoutForWidth, fitTransform, graphEdgePath, NodeDetail, MapLabel, MapLines, buildMapRows, enrichRoadmap, autoCollapseIds, MapLegend, ScopeDriftSide, ScopeDriftPanel, SessionRow, GoalLine, sessionIdOfProps }; return module.exports')

let factory = null
const sandboxWindow = { __ModuleLoader__: { load: options => { factory = options.factory } } }
const sandbox = { window: sandboxWindow, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, Blob: class {} }
sandbox.navigator = {}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

// --- mock React: enough hooks for a synchronous render pass -----------------
const mockReact = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
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

let capturedExports = null
try {
  capturedExports = factory(() => mockReact)
} catch (error) {
  console.log('FACTORY THREW:', error.stack)
  process.exit(1)
}
if (capturedExports.__test === undefined) {
  console.log('PATCH FAILED: no __test export')
  process.exit(1)
}

async function main() {
  // The desktop app picks a new port on some restarts; probe the known ones and
  // let a caller pin the current one (argv[2] / --port=NNNN / MAINLINE_STATE_URL).
  // Otherwise auto-discover the desktop shell's own listening TCP port — it
  // changes on many restarts, so a hardcoded list always ends up stale.
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
      /* discovery is best-effort; the hardcoded list below still applies */
    }
  }
  const bases = [
    process.argv[2],
    portFlag === undefined ? undefined : `http://127.0.0.1:${portFlag.slice('--port='.length)}`,
    process.env.MAINLINE_STATE_URL,
    ...autoPorts,
    'http://127.0.0.1:19387',
    'http://127.0.0.1:63743',
    'http://127.0.0.1:58856',
    'http://127.0.0.1:49156',
    'http://127.0.0.1:56937',
    'http://127.0.0.1:52445',
    'http://127.0.0.1:51252',
  ]
    .filter(Boolean)
    .map(url => url.replace(/\/state\/?$/, '').replace(/\/$/, ''))
  let state = null
  let usedBase = null
  for (const base of [...new Set(bases)]) {
    try {
      const response = await fetch(`${base}/dsh-mainline/state`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(3000) })
      if (!response.ok) continue
      state = await response.json()
      usedBase = base
      break
    } catch {
      /* try the next port */
    }
  }
  if (state === null) {
    console.log('HARNESS ERROR: no /dsh-mainline/state reachable (tried: ' + bases.join(', ') + ')')
    process.exit(1)
  }
  console.log(`[probe] using ${usedBase}`)
  const document_ = state.config.document
  const alerts = state.alerts
  const current = state.current
  const now = Date.now()

  // Deep-walk: execute function components, recurse into children/arrays.
  let executed = 0
  function walk(element, depth) {
    if (element === null || element === undefined || typeof element !== 'object') return
    if (Array.isArray(element)) {
      element.forEach(child => walk(child, depth))
      return
    }
    if (typeof element.type === 'function') {
      executed += 1
      const output = element.type(element.props)
      walk(output, depth + 1)
      return
    }
    if (element.children !== undefined) walk(element.children, depth + 1)
  }

  /** Every class name the tree renders, with function components executed. */
  function classNamesOf(element, out) {
    if (element === null || element === undefined || typeof element !== 'object') return out
    if (Array.isArray(element)) {
      element.forEach(child => classNamesOf(child, out))
      return out
    }
    if (typeof element.type === 'function') {
      classNamesOf(element.type(element.props), out)
      return out
    }
    if (typeof element.props.className === 'string') out.push(element.props.className)
    classNamesOf(element.children, out)
    return out
  }

  const doc = capturedExports.__test.enrichRoadmap(document_)
  const cases = [
    ['RoadmapMap', () => capturedExports.__test.RoadmapMap({ document_: doc, alerts, current, now })],
    ['RoadmapMap(null view)', () => capturedExports.__test.RoadmapMap({ document_: null, alerts: [], current: null, now })],
    ['NodeDetail(task)', () => capturedExports.__test.NodeDetail({
      selection: { kind: 'task', milestone: doc.milestones[1], task: doc.milestones[1].tasks[1] },
      alerts, onClose: () => {}, onToggleFold: () => {}, folded: false,
    })],
    ['NodeDetail(milestone)', () => capturedExports.__test.NodeDetail({
      selection: { kind: 'milestone', milestone: doc.milestones[0] },
      alerts, onClose: () => {}, onToggleFold: () => {}, folded: false,
    })],
    ['buildMapRows(no alert rows on the map)', () => {
      const rows = capturedExports.__test.buildMapRows(doc, current, new Set())
      if (rows.some(row => row.kind === 'alert')) throw new Error('alert row leaked back onto the map')
      return { type: 'div', props: {}, children: rows }
    }],
    ['ScopeDriftSide(with sessionId)', () => capturedExports.__test.ScopeDriftSide({ sessionId: 'sess-abcd1234' })],
    ['ScopeDriftSide(no props)', () => capturedExports.__test.ScopeDriftSide(undefined)],
    ['SessionRow', () => capturedExports.__test.SessionRow({
      sessions: [
        { id: 'sess-abcd1234', tail: 'abcd1234', cwd: 'D:/work/demo', title: null, lastAt: '2026-01-01T00:00:00Z' },
        { id: 'sess-eeee5678', tail: 'eeee5678', cwd: 'D:/work/other', title: '写文档', lastAt: '2026-01-01T01:00:00Z' },
      ],
      active: 'sess-abcd1234',
      onPick: () => {},
    })],
    ['GoalLine(with goal)', () => capturedExports.__test.GoalLine({
      goal: { objective: '完成主线插件的会话跟随与多项目判定', status: 'active' },
    })],
    ['GoalLine(complete + blocked states)', () => capturedExports.__test.GoalLine({ goal: { objective: 'x', status: 'complete' } })
      && capturedExports.__test.GoalLine({ goal: { objective: 'y', status: 'blocked' } })],
    ['GoalLine(null)', () => capturedExports.__test.GoalLine({ goal: null })],
    ['ScopeDriftPanel', () => capturedExports.__test.ScopeDriftPanel()],
    ['RoadmapFlow(graph: root + milestones + tasks)', () => {
      const tree = capturedExports.__test.RoadmapFlow({
        document_: doc,
        current,
        collapsedSet: new Set(),
        toggleFold: () => {},
        selected: { kind: 'task', milestoneId: doc.milestones[0].id, taskId: doc.milestones[0].tasks[0]?.id },
        onSelect: () => {},
      })
      const names = classNamesOf(tree, []).join(' ')
      if (!names.includes('sd-graph')) throw new Error('flow rendered no canvas')
      if (!names.includes('sd-graph-edges')) throw new Error('flow rendered no edge layer')
      if (!names.includes('sd-gcontrols')) throw new Error('flow rendered no control cluster')
      if (!names.includes('sd-gframe')) throw new Error('flow drew no phase frame around a milestone')
      const text = JSON.stringify(tree)
      const cards = (text.match(/"data-gnode"/g) ?? []).length
      const expected = 1 + doc.milestones.length + doc.milestones.reduce((sum, entry) => sum + entry.tasks.length, 0)
      if (cards !== expected) throw new Error(`flow drew ${cards} cards, expected ${expected} (project + milestones + tasks)`)
      const paths = (text.match(/"className":"sd-edge/g) ?? []).length
      const expectedEdges = doc.milestones.length + doc.milestones.reduce((sum, entry) => sum + entry.tasks.length, 0)
      if (paths !== expectedEdges) throw new Error(`flow drew ${paths} edges, expected ${expectedEdges}`)
      return tree
    }],
    ['RoadmapFlow(collapsed + no selection)', () => {
      const tree = capturedExports.__test.RoadmapFlow({
        document_: doc,
        current: null,
        collapsedSet: new Set(doc.milestones.map(entry => entry.id)),
        toggleFold: () => {},
        selected: null,
        onSelect: () => {},
      })
      const text = JSON.stringify(tree)
      const cards = (text.match(/"data-gnode"/g) ?? []).length
      const expected = 1 + doc.milestones.length
      if (cards !== expected) throw new Error(`folded graph drew ${cards} cards, expected ${expected}`)
      if (!text.includes('点击展开')) throw new Error('folded milestone card offers no expand affordance')
      return tree
    }],
    ['RoadmapFlow(empty roadmap)', () => capturedExports.__test.RoadmapFlow({
      document_: { milestones: [] }, current: null, collapsedSet: new Set(), toggleFold: () => {}, selected: null, onSelect: () => {},
    })],
    ['edge path: leaves the parent bottom, enters the child top', () => {
      const from = { x: 100, y: 100, w: 190, h: 88 }
      const to = { x: 60, y: 240, w: 190, h: 88 }
      const d = capturedExports.__test.graphEdgePath(from, to)
      const numbers = d.match(/-?\d+(\.\d+)?/g).map(Number)
      const [x1, y1] = numbers
      const [x2, y2] = numbers.slice(-2)
      if (x1 !== 195 || y1 !== 188) throw new Error(`edge starts at ${x1},${y1} instead of the parent's bottom centre 195,188`)
      if (x2 !== 155 || y2 !== 240) throw new Error(`edge ends at ${x2},${y2} instead of the child's top centre 155,240`)
      if ((d.match(/C /g) ?? []).length !== 1) throw new Error('edge is not a single bezier between its stubs')
      return { type: 'div', props: {}, children: [] }
    }],
    ['graph layout: stable across widths, never overlaps', () => {
      const rootNode = capturedExports.__test.graphNodes(doc, new Set())
      let baseline = null
      for (const width of [0, 360, 720, 1200]) {
        const layout = capturedExports.__test.layoutForWidth(rootNode, width)
        if (!(layout.width > 0) || !(layout.height > 0)) throw new Error(`layout at ${width}px has no extent`)
        const boxes = [...layout.boxes.values()]
        if (layout.boxes.size !== 1 + doc.milestones.length + doc.milestones.reduce((sum, m) => sum + m.tasks.length, 0)) {
          throw new Error(`layout at ${width}px dropped nodes`)
        }
        for (const box of boxes) {
          if (box.x < 0 || box.y < 0) throw new Error(`layout at ${width}px placed a card at a negative offset`)
          if (box.x + box.w > layout.width || box.y + box.h > layout.height) throw new Error(`layout at ${width}px let a card escape the canvas`)
        }
        // Cards must never overlap: every pair is separated on at least one axis.
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i]
            const b = boxes[j]
            const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
            if (!apart) throw new Error(`layout at ${width}px overlaps two cards`)
          }
        }
        const geometry = JSON.stringify({ width: layout.width, height: layout.height, boxes: [...layout.boxes.entries()] })
        if (baseline === null) baseline = geometry
        else if (geometry !== baseline) throw new Error(`layout at ${width}px changed the stable card geometry`)
      }
      return { type: 'div', props: {}, children: [] }
    }],
    ['fit transform: floor, centring, and the root inside the viewport', () => {
      const fit = capturedExports.__test.fitTransform(360, 420, 1400, 900)
      if (fit.k !== 0.78) throw new Error(`fit scale ${fit.k} is not the readability floor`)
      if (fit.y !== 0) throw new Error('a taller-than-viewport graph must be pinned to the top, not centred vertically')
      // The project card sits at the horizontal middle of the canvas, so a
      // centred frame keeps it on screen even when the canvas is 2× too wide.
      const rootCenterX = 1400 / 2
      const screenX = rootCenterX * fit.k + fit.x
      if (!(screenX > 0 && screenX < 360)) throw new Error(`centring put the root off screen (x=${screenX})`)
      const small = capturedExports.__test.fitTransform(900, 500, 400, 200)
      if (!(small.k <= 1.4)) throw new Error('fit scaled past its cap')
      if (small.y < 0) throw new Error('fit pushed a short graph above the viewport')
      // A TALL panel with a short tree must scale UP to fill the height, not
      // leave the bottom third empty (the "图只占了上半部分" report).
      const tall = capturedExports.__test.fitTransform(900, 700, 876, 528)
      const fills = (528 * tall.k) / 700
      if (fills < 0.8) throw new Error(`tall canvas left ${Math.round((1 - fills) * 100)}% empty`)
      return { type: 'div', props: {}, children: [] }
    }],
    ['ViewSwitch(two forms, tree pressed)', () => {
      const tree = capturedExports.__test.ViewSwitch({ mode: 'tree', onChange: () => {} })
      const text = JSON.stringify(tree)
      if (!text.includes('树状图') || !text.includes('工作流图')) throw new Error('view switch lost one of its two labels')
      const pressed = (text.match(/"aria-pressed":true/g) ?? []).length
      if (pressed !== 1) throw new Error(`expected exactly one pressed form, got ${pressed}`)
      const flow = JSON.stringify(capturedExports.__test.ViewSwitch({ mode: 'flow', onChange: () => {} }))
      if (!flow.includes('"aria-pressed":false')) throw new Error('flow mode did not release the tree button')
      return tree
    }],
    ['readViewMode(no storage → tree)', () => {
      const mode = capturedExports.__test.readViewMode()
      if (mode !== 'tree') throw new Error(`fallback mode is ${mode}, expected tree`)
      return { type: 'div', props: {}, children: [] }
    }],
    ['RoadmapMap(flow form, persisted choice)', () => {
      // The stored choice is the only thing that makes the map open on the
      // flow: stub it, render the REAL RoadmapMap, then restore.
      sandboxWindow.localStorage = { getItem: () => 'flow', setItem: () => {} }
      try {
        const tree = capturedExports.__test.RoadmapMap({ document_: doc, alerts, current, now })
        const names = classNamesOf(tree, [])
        const flat = names.join(' ')
        if (!names.some(name => name.split(' ').includes('sd-graph'))) throw new Error('stored flow choice did not render the graph canvas')
        if (names.some(name => name.includes('sd-map-lines'))) throw new Error('flow mode also painted the trunk overlay')
        if (!names.some(name => name.includes('sd-map-toolbar'))) throw new Error('the view toolbar is missing')
        if (!flat.includes('sd-gcontrols')) throw new Error('flow mode rendered no zoom controls')
        return tree
      } finally {
        delete sandboxWindow.localStorage
      }
    }],
  ]
  let failed = false
  for (const [name, build] of cases) {
    executed = 0
    try {
      walk(build(), 0)
      console.log(`ok   ${name} (${executed} components executed)`)
    } catch (error) {
      failed = true
      console.log(`CRASH ${name}: ${error.message}`)
      console.log(error.stack.split('\n').slice(0, 6).join('\n'))
    }
  }
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.log('HARNESS ERROR:', error.stack); process.exit(1) })
