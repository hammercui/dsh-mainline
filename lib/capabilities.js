/** Durable, bounded capability evidence. No services, clocks, or log rescans.
 * Native tool events only: an MCP-shaped name is NOT remote-server provenance.
 * Historical loads mean instructions were delivered, not still in model context.
 */
export const CAPABILITIES_KEY = 'mainline.capabilities'
export const CAPABILITIES_LIMITS = Object.freeze({ rows: 80, pending: 128, catalog: 200, description: 240, catalogText: 262144, catalogDescription: 8192 })
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TOOL_NAME = /^mcp__[A-Za-z0-9_-]{1,59}$/
const ERROR_CODES = new Set(['ABORTED', 'ABORTED_BEFORE_DISPATCH', 'UNKNOWN_TOOL', 'TOOL_TIMEOUT'])
const count = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1)
const validSkill = value => typeof value === 'string' && value.length <= 128 && SKILL_NAME.test(value)
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512

export function initialCapabilities() {
  return { rows: [], pending: [], catalog: [], dropped: 0, lastSeq: -1 }
}
// Only durable skill-catalog provenance is accepted; pasted catalog-looking user
// text, invocation bodies and tool results are never sources of descriptions.
function catalogEntries(data) {
  if (data.source.form !== 'catalog') return null
  let entries = data.source.entries
  if (entries === undefined) {
    // Compatibility with older catalogs: parse only the exact shipped section,
    // never surrounding instructions. New structured entries take precedence.
    if (!Array.isArray(data.content) || data.content.length !== 1) return null
    const block = data.content[0]
    if (block?.type !== 'text' || typeof block.text !== 'string' || block.text.length > CAPABILITIES_LIMITS.catalogText) return null
    const lines = block.text.split('\n')
    const start = lines.indexOf('<available_skills>'), end = lines.indexOf('</available_skills>')
    if (start < 0 || end <= start || end - start - 1 > CAPABILITIES_LIMITS.catalog ||
      lines.lastIndexOf('<available_skills>') !== start || lines.lastIndexOf('</available_skills>') !== end) return null
    entries = []
    for (const line of lines.slice(start + 1, end)) {
      const match = /^- `([a-z0-9]+(?:-[a-z0-9]+)*)`: (.*)$/.exec(line)
      if (!match) return null
      const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>' }
      entries.push({ name: match[1], description: match[2].replace(/&(?:amp|lt|gt);/g, value => entities[value]) })
    }
  }
  if (!Array.isArray(entries) || entries.length > CAPABILITIES_LIMITS.catalog) return null
  const seen = new Set(), catalog = []
  for (const entry of entries) {
    if (!entry || !validSkill(entry.name) || seen.has(entry.name) || typeof entry.description !== 'string' ||
      entry.description.length > CAPABILITIES_LIMITS.catalogDescription) return null
    seen.add(entry.name)
    const text = entry.description.replace(/\s+/g, ' ').trim()
    // Empty catalog descriptions stay unknown; no curated fallback is invented.
    if (text) catalog.push({ name: entry.name, description: text.length <= CAPABILITIES_LIMITS.description ? text : `${text.slice(0, CAPABILITIES_LIMITS.description - 3)}...` })
  }
  return catalog.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}
function stamp(row, event) {
  row.lastSeq = event.seq
  row.lastAt = Number.isFinite(event.time) && event.time >= 0 && event.time <= Number.MAX_SAFE_INTEGER ? event.time : null
}
// A display hint only, never authoritative provenance. Ambiguous delimiters stay unknown.
function inferredServer(name) {
  const parts = name.split('__')
  return parts.length === 3 && parts[0] === 'mcp' && /^[A-Za-z0-9_-]{1,32}$/.test(parts[1]) && parts[2] !== '' ? parts[1] : null
}
function rowFor(state, kind, name) {
  let row = state.rows.find(item => item.kind === kind && item.name === name)
  if (!row) {
    if (state.rows.length >= CAPABILITIES_LIMITS.rows) {
      const removed = state.rows.shift()
      state.pending = state.pending.filter(item => !(item.kind === removed.kind && item.name === removed.name))
      state.dropped = count(state.dropped)
    }
    const serverLabel = kind === 'mcp-tool' ? inferredServer(name) : null
    row = { kind, name, description: kind === 'skill' ? state.catalog.find(entry => entry.name === name)?.description ?? null : null, serverLabel, attribution: kind === 'mcp-tool' ? (serverLabel === null ? 'unknown-server' : 'inferred-server') : 'skill', lastSeq: -1, lastAt: null, attempts: 0,
      succeeded: 0, failed: 0, interrupted: 0, notDispatched: 0, unverified: 0, userLoads: 0,
      pending: 0, lastStatus: 'loading', lastErrorCode: null }
    state.rows.push(row)
  }
  return row
}
function finish(state, pending, status, code = null, event) {
  const row = state.rows.find(item => item.kind === pending.kind && item.name === pending.name)
  if (row) {
    row.pending = Math.max(0, row.pending - 1)
    row[status] = count(row[status])
    row.lastStatus = status
    row.lastErrorCode = code
    if (event) stamp(row, event)
  }
  state.pending = state.pending.filter(item => item.callId !== pending.callId)
}
function clone(state, seq) {
  return { ...state, lastSeq: seq, rows: state.rows.map(row => ({ ...row })), pending: state.pending.slice() }
}

export function applyCapabilities(state, event) {
  if (!event || !Number.isSafeInteger(event.seq) || event.seq < 0 || event.seq <= state.lastSeq) return state
  const data = event.data
  if (!data || typeof data !== 'object') return state
  if (event.type === 'user/message') {
    const source = data.source
    if (source?.kind === 'skill-catalog') {
      const catalog = catalogEntries(data)
      if (catalog === null || (catalog.length === state.catalog.length && catalog.every((entry, i) => entry.name === state.catalog[i].name && entry.description === state.catalog[i].description))) return state
      const next = clone(state, event.seq)
      next.catalog = catalog
      // Complete replacement catalog, not evidence of execution or current load.
      // Removed/missing descriptions become unknown, without changing row stamps.
      for (const row of next.rows) if (row.kind === 'skill') row.description = catalog.find(entry => entry.name === row.name)?.description ?? null
      return next
    }
    if (source?.kind !== 'skill-invocation' || source.form !== 'instructions' || !validSkill(source.name)) return state
    const next = clone(state, event.seq)
    const row = rowFor(next, 'skill', source.name)
    row.userLoads = count(row.userLoads)
    row.lastStatus = 'user-loaded'
    stamp(row, event)
    row.lastErrorCode = null
    return next
  }
  if (event.type === 'tool/call') {
    if (!validId(data.callId) || state.pending.some(item => item.callId === data.callId)) return state
    let kind, name
    if (data.name === 'skill') {
      kind = 'skill'
      // Parse only bounded arguments and retain only a grammar-checked skill name.
      let args
      try { if (typeof data.arguments === 'string' && data.arguments.length <= 8192) args = JSON.parse(data.arguments) } catch {}
      name = validSkill(args?.name) ? args.name : '(invalid skill)'
    } else if (typeof data.name === 'string' && TOOL_NAME.test(data.name)) {
      kind = 'mcp-tool'
      name = data.name
    } else return state
    const next = clone(state, event.seq)
    if (next.pending.length >= CAPABILITIES_LIMITS.pending) {
      finish(next, next.pending[0], 'unverified')
      next.dropped = count(next.dropped)
    }
    const row = rowFor(next, kind, name)
    row.attempts = count(row.attempts)
    row.pending = count(row.pending)
    row.lastStatus = 'loading'
    stamp(row, event)
    row.lastErrorCode = null
    next.pending.push({ callId: data.callId, kind, name })
    return next
  }
  if (event.type === 'tool/result') {
    const message = data.message
    const pending = state.pending.find(item => item.callId === message?.toolCallId)
    if (!pending) return state
    const next = clone(state, event.seq)
    const code = typeof data.error?.code === 'string' ? data.error.code : null
    const safeCode = code === null ? null : ERROR_CODES.has(code) ? code : 'OTHER'
    let status
    if (code === 'ABORTED_BEFORE_DISPATCH' || code === 'UNKNOWN_TOOL') status = 'notDispatched'
    else if (code === 'ABORTED') status = 'interrupted'
    else if (message.isError === true || data.error) status = 'failed'
    else if (pending.kind === 'skill') {
      const marker = `<skill_content name="${pending.name}">`
      status = Array.isArray(message.content) && message.content.some(block => block?.type === 'text' && typeof block.text === 'string' && block.text.startsWith(marker)) ? 'succeeded' : 'unverified'
    } else status = 'succeeded'
    finish(next, pending, status, safeCode, event)
    return next
  }
  if (event.type === 'turn/end' && state.pending.length) {
    const next = clone(state, event.seq)
    for (const pending of state.pending) finish(next, pending, 'interrupted', null, event)
    return next
  }
  return state
}

/** Supply the Host's actual Zod runtime; this module imports no Harness internals.
 * Register the returned definition through ctx.sessionProjections.register().
 * Wire views omit private call correlation IDs; WeakMap preserves reference identity.
 */
export function createCapabilitiesProjection(z) {
  const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  const kind = z.enum(['skill', 'mcp-tool'])
  const row = z.object({
    kind, name: z.string().max(128), description: z.string().min(1).max(CAPABILITIES_LIMITS.description).nullable(), attribution: z.enum(['skill', 'unknown-server', 'inferred-server']),
    serverLabel: z.string().max(32).nullable(), lastSeq: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
    lastAt: z.number().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    attempts: counter, succeeded: counter, failed: counter, interrupted: counter,
    notDispatched: counter, unverified: counter, userLoads: counter, pending: counter,
    lastStatus: z.enum(['loading', 'succeeded', 'failed', 'interrupted', 'notDispatched', 'unverified', 'user-loaded']),
    lastErrorCode: z.enum(['ABORTED', 'ABORTED_BEFORE_DISPATCH', 'UNKNOWN_TOOL', 'TOOL_TIMEOUT', 'OTHER']).nullable(),
  }).strict()
  const stateSchema = z.object({
    rows: z.array(row).max(CAPABILITIES_LIMITS.rows),
    catalog: z.array(z.object({ name: z.string().min(1).max(128).regex(SKILL_NAME), description: z.string().min(1).max(CAPABILITIES_LIMITS.description) }).strict()).max(CAPABILITIES_LIMITS.catalog),
    pending: z.array(z.object({ callId: z.string().min(1).max(512), kind, name: z.string().max(128) }).strict()).max(CAPABILITIES_LIMITS.pending),
    dropped: counter, lastSeq: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  }).strict()
  const viewSchema = z.object({ rows: z.array(row).max(CAPABILITIES_LIMITS.rows), dropped: counter,
    lastSeq: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER) }).strict()
  const views = new WeakMap()
  return { key: CAPABILITIES_KEY, stateVersion: 3, stateSchema,
    init: initialCapabilities, apply: applyCapabilities,
    wire: { viewSchema, view(state) {
      if (!views.has(state)) views.set(state, { rows: state.rows, dropped: state.dropped, lastSeq: state.lastSeq })
      return views.get(state)
    } } }
}
