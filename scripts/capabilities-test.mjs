import assert from 'node:assert/strict'
import { z } from 'zod'
import { initialCapabilities as init, applyCapabilities as apply, CAPABILITIES_LIMITS as limits, createCapabilitiesProjection } from '../lib/capabilities.js'
const call = (seq, id, name = 'skill', args = '{"name":"office"}') => ({ seq, type: 'tool/call', data: { callId: id, name, arguments: args } })
const result = (seq, id, code, text = '<skill_content name="office">instructions</skill_content>') => ({ seq, type: 'tool/result', data: {
  message: { toolCallId: id, isError: Boolean(code), content: [{ type: 'text', text }] }, ...(code ? { error: { name: 'Error', code } } : {}),
} })
const end = seq => ({ seq, type: 'turn/end', data: { turn: 1, reason: { kind: 'interrupted' } } })
const events = [call(0, 'a'), result(1, 'a'), call(2, 'b'), result(3, 'b')]
events.forEach((event, index) => { event.time = index + 100 })
const fold = (xs, state = init()) => xs.reduce(apply, state)
const state = fold(events)
assert.equal(state.rows[0].succeeded, 2)
assert.equal(state.rows[0].attempts, 2)
assert.equal(state.rows[0].lastSeq, 3)
assert.equal(state.rows[0].lastAt, 103)
assert.equal(state.pending.length, 0)
assert.deepEqual(fold(events), state, 'replay deterministic')
assert.deepEqual(fold(events.slice(2), JSON.parse(JSON.stringify(fold(events.slice(0, 2))))), state, 'checkpoint tail')
assert.deepEqual(init(), { rows: [], pending: [], catalog: [], dropped: 0, lastSeq: -1 }, 'session isolation')
assert.strictEqual(apply(state, events[3]), state, 'duplicate event')
assert.strictEqual(apply(state, { seq: 10, type: 'step/start', data: {} }), state)
assert.strictEqual(apply(state, { seq: 10, type: 'assistant/message', data: { interrupted: true } }), state, 'partial assistant not execution evidence')
for (const [code, expected] of [['ABORTED', 'interrupted'], ['ABORTED_BEFORE_DISPATCH', 'notDispatched'], ['UNKNOWN_TOOL', 'notDispatched'], ['TOOL_TIMEOUT', 'failed'], ['CUSTOM_PRIVATE_TEXT', 'failed']]) {
  const s = fold([call(0, 'a'), result(1, 'a', code)])
  assert.equal(s.rows[0][expected], 1)
  assert.equal(s.rows[0].succeeded, 0)
  assert.ok(!JSON.stringify(s).includes('CUSTOM_PRIVATE_TEXT'))
}
assert.equal(fold([call(0, 'a'), end(1)]).rows[0].interrupted, 1)
assert.equal(fold([call(0, 'a'), result(1, 'a', null, 'replacement')]).rows[0].unverified, 1)
assert.equal(fold([call(0, 'a', 'skill', '{bad')]).rows[0].name, '(invalid skill)')
assert.equal(fold([call(0, 'a', 'skill', '{"name":"https://secret.invalid"}')]).rows[0].name, '(invalid skill)')
const user = { seq: 0, type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'office', form: 'instructions' } } }
assert.equal(fold([user]).rows[0].userLoads, 1)
assert.equal(fold([{ ...user, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '/office' }] } }]).rows.length, 0)
assert.equal(fold([{ ...user, data: { source: { kind: 'skill-catalog' } } }]).rows.length, 0)
const mcp = fold([call(0, 'a', 'mcp__a__b__search', 'https://secret.invalid'), result(1, 'a', null, 'raw private result')])
assert.equal(mcp.rows[0].attribution, 'unknown-server')
assert.equal(mcp.rows[0].serverLabel, null)
const inferred = fold([call(0, 'a', 'mcp__server__search'), result(1, 'a', null, 'ok')])
assert.equal(inferred.rows[0].attribution, 'inferred-server')
assert.equal(inferred.rows[0].serverLabel, 'server')
assert.equal(mcp.rows[0].name, 'mcp__a__b__search')
assert.equal(mcp.rows[0].succeeded, 1)
assert.ok(!JSON.stringify(mcp).includes('secret'))
assert.ok(!JSON.stringify(mcp).includes('private'))
let bounded = init()
for (let n = 0; n < 300; n++) bounded = apply(bounded, call(n, `call${n}`, 'mcp__server__search'))
assert.equal(bounded.pending.length, limits.pending)
assert.equal(bounded.rows[0].pending, limits.pending)
assert.equal(bounded.rows[0].unverified, 300 - limits.pending)
for (let n = 300; n < 600; n++) bounded = apply(bounded, call(n, `call${n}`, `mcp__server__tool${n}`))
assert.equal(bounded.rows.length, limits.rows)
assert.ok(bounded.pending.length <= limits.pending)
assert.ok(bounded.dropped > 0)
assert.ok(JSON.stringify(bounded).length < 100000)
const frozen = Object.freeze({ ...state, rows: Object.freeze(state.rows.map(Object.freeze)), pending: Object.freeze(state.pending) })
assert.doesNotThrow(() => apply(frozen, call(10, 'later')))
// Validate real persisted and wire payloads with the package's installed Zod runtime.
const definition = createCapabilitiesProjection(z)
assert.equal(definition.stateVersion, 3)
const wire = definition.wire.view(state)
assert.notEqual(wire, state)
assert.equal('pending' in wire, false)
assert.strictEqual(definition.wire.view(state), wire)
assert.strictEqual(definition.apply, apply)
for (const candidate of [init(), state, bounded, mcp, inferred, fold([user])]) {
  assert.deepEqual(definition.stateSchema.parse(candidate), candidate)
  const view = definition.wire.view(candidate)
  assert.deepEqual(definition.wire.viewSchema.parse(view), view)
  assert.ok(!JSON.stringify(view).includes('callId'))
}
assert.equal(definition.stateSchema.safeParse({ ...state, extra: 'rejected' }).success, false)
assert.equal(definition.wire.viewSchema.safeParse({ ...wire, pending: [] }).success, false)
for (const time of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1, 'today']) {
  const s = fold([{ ...call(0, 'a'), time }])
  assert.equal(s.rows[0].lastAt, null)
  assert.equal(definition.stateSchema.safeParse(s).success, true)
}
assert.equal(fold([{ ...call(0, 'a'), time: 0 }]).rows[0].lastAt, 0)
const overflow = Array.from({ length: limits.pending + 1 }, (_, seq) => call(seq, `private-id-${seq}`)).reduce(apply, init())
assert.equal(overflow.rows[0].interrupted, 0, 'overflow is not cancellation')
assert.equal(overflow.rows[0].unverified, 1)
const finalized = apply(overflow, end(limits.pending + 2))
assert.equal(finalized.rows[0].interrupted, limits.pending)
assert.equal(finalized.rows[0].unverified, 1, 'evicted call remains unknown')
assert.equal(fold([call(0, 'a'), result(1, 'a', null, '<skill_content name="other">body')]).rows[0].unverified, 1)
assert.equal(fold([call(0, 'a'), result(1, 'a', 'TOOL_TIMEOUT')]).rows[0].succeeded, 0, 'error overrides success-looking body')
const wrapped = init()
assert.strictEqual(apply(wrapped, call(0, 'a', 'multi_tool_use.parallel')), wrapped, 'wrapper arguments are not dispatch evidence')
// Shipped source.entries is authoritative; the text fallback is solely for older
// durable catalog records, not an arbitrary user-provided pasted skills list.
const officeDescription = 'Create, edit, inspect, or convert Office documents, spreadsheets, presentations, and PDFs. Load to choose the relevant workflow.'
const entry = { name: 'office', description: officeDescription }
const catalog = (seq, entries = [entry]) => ({ seq, type: 'user/message', data: { source: { kind: 'skill-catalog', form: 'catalog', entries } } })
const legacy = (seq, section = `- \`office\`: ${officeDescription}`) => ({ seq, type: 'user/message', data: {
  source: { kind: 'skill-catalog', form: 'catalog' }, content: [{ type: 'text', text: `<system-reminder>\nA skill is a reusable set of task-specific instructions. The following skills are available in this session:\n\n<available_skills>\n${section}\n</available_skills>\n\nCatalog instructions outside the section.\n</system-reminder>` }],
} })
const beforeEvents = [catalog(0), call(1, 'a'), result(2, 'a')]
const before = fold(beforeEvents)
const afterEvents = [call(0, 'a'), result(1, 'a'), catalog(2)]
const after = fold(afterEvents)
assert.deepEqual(fold(afterEvents), after, 'late catalog replay deterministic')
assert.deepEqual(fold(afterEvents.slice(2), JSON.parse(JSON.stringify(fold(afterEvents.slice(0, 2))))), after, 'late catalog checkpoint tail')
assert.equal(before.rows[0].description, officeDescription)
assert.equal(after.rows[0].description, officeDescription)
assert.equal(after.rows[0].lastSeq, 1, 'catalog metadata is not execution evidence')
assert.equal(after.rows[0].succeeded, 1)
assert.deepEqual(fold(beforeEvents), before, 'description replay deterministic')
for (let split = 1; split < beforeEvents.length; split++) {
  assert.deepEqual(fold(beforeEvents.slice(split), JSON.parse(JSON.stringify(fold(beforeEvents.slice(0, split))))), before, 'catalog survives checkpoint before and after call')
}
assert.equal(fold([catalog(0)]).rows.length, 0, 'catalog never creates capability-use rows')
assert.equal(fold([catalog(0), { ...user, seq: 1 }]).rows[0].description, officeDescription)
assert.equal(state.rows[0].description, null, 'missing catalog is explicitly unknown')
assert.equal(fold([{ ...user, data: { ...user.data, source: { ...user.data.source, description: 'not a shipped invocation field' } } }]).rows[0].description, null)
assert.equal(mcp.rows[0].description, null)
assert.strictEqual(apply(before, catalog(10)), before, 'repeated catalog preserves reference')
assert.strictEqual(apply(before, { ...legacy(10), data: { ...legacy(10).data, source: { kind: 'user' } } }), before, 'pasted text is not verified provenance')
assert.strictEqual(apply(before, { ...catalog(10), type: 'assistant/message' }), before)
assert.equal(fold([legacy(0), call(1, 'a')]).rows[0].description, officeDescription)
assert.equal(fold([legacy(0, '- `office`: A &lt; B &amp; C &gt; D &amp;lt;'), call(1, 'a')]).rows[0].description, 'A < B & C > D &lt;', 'decode shipped entities exactly once')
const outside = legacy(0)
outside.data.content[0].text = '- `outside`: not catalog data\n' + outside.data.content[0].text + '\n- `outside-after`: not catalog data'
assert.deepEqual(fold([outside]).catalog, [entry], 'parse only framed section')
const authoritative = catalog(0)
authoritative.data.content = legacy(0, '- `office`: not authoritative').data.content
assert.deepEqual(fold([authoritative]).catalog, [entry], 'structured source wins over prose')
const replacement = apply(before, catalog(10, [{ ...entry, description: 'Updated actual catalog text' }]))
assert.equal(replacement.rows[0].description, 'Updated actual catalog text')
assert.equal(before.rows[0].description, officeDescription, 'prior state remains immutable')
const removed = apply(before, catalog(10, []))
assert.equal(removed.rows[0].description, null, 'complete replacement removes stale description')
assert.equal(removed.rows[0].succeeded, 1, 'replacement keeps historical execution evidence')
assert.deepEqual(removed.catalog, [])
assert.strictEqual(apply(removed, catalog(11, [])), removed)
assert.equal(fold([catalog(0, [{ ...entry, description: ' \n\t' }]), call(1, 'a')]).rows[0].description, null)
const shortened = fold([catalog(0, [{ ...entry, description: 'x'.repeat(limits.description + 10) }]), call(1, 'a')])
assert.equal(shortened.rows[0].description, 'x'.repeat(limits.description - 3) + '...')
assert.equal(fold([catalog(0, [{ ...entry, description: 'one\n two\tthree' }]), call(1, 'a')]).rows[0].description, 'one two three')
const fullCatalog = Array.from({ length: limits.catalog }, (_, i) => ({ name: `skill-${i}`, description: `Catalog summary ${i}` }))
const full = fold([catalog(0, fullCatalog), call(1, 'full', 'skill', `{"name":"skill-${limits.catalog - 1}"}`)])
assert.equal(full.catalog.length, limits.catalog)
assert.equal(full.rows[0].description, `Catalog summary ${limits.catalog - 1}`)
assert.strictEqual(apply(full, catalog(10, fullCatalog.slice().reverse())), full, 'catalog order alone is irrelevant')
for (const entries of [null, {}, [null], [{ name: 'office' }], [{ name: '../office', description: 'bad' }], [entry, entry], [{ ...entry, description: 5 }], [{ ...entry, description: 'x'.repeat(limits.catalogDescription + 1) }], [...fullCatalog, { name: 'overflow', description: 'too many' }]]) {
  assert.strictEqual(apply(before, catalog(10, entries)), before, 'malformed or oversized structured catalog ignored atomically')
}
const badLegacy = [
  legacy(10, 'office: not shipped syntax'), legacy(10, '- `office`: valid\nnot a catalog row'),
  legacy(10, '- `office`: first\n- `office`: duplicate'), legacy(10, '- `BadName`: invalid'),
  legacy(10, '- `office`: ' + 'x'.repeat(limits.catalogDescription + 1)),
  legacy(10, Array.from({ length: limits.catalog + 1 }, (_, i) => `- \`skill-${i}\`: too many`).join('\n')),
]
for (const text of ['<available_skills>\n- `office`: no closing tag', '<available_skills>\n</available_skills>\n<available_skills>\n</available_skills>', 'x'.repeat(limits.catalogText + 1)]) {
  const event = legacy(10); event.data.content[0].text = text; badLegacy.push(event)
}
const wrongForm = legacy(10); wrongForm.data.source.form = 'instructions'; badLegacy.push(wrongForm)
const malformedPreferred = legacy(10); malformedPreferred.data.source.entries = null; badLegacy.push(malformedPreferred)
const multipleBlocks = legacy(10); multipleBlocks.data.content.push({ type: 'text', text: 'extra' }); badLegacy.push(multipleBlocks)
for (const event of badLegacy) assert.strictEqual(apply(before, event), before, 'bad catalog framing is not evidence')
for (const candidate of [before, after, replacement, removed, shortened, full]) {
  assert.deepEqual(definition.stateSchema.parse(candidate), candidate)
  const view = definition.wire.view(candidate)
  assert.deepEqual(definition.wire.viewSchema.parse(view), view)
  assert.equal('catalog' in view, false, 'lookup is private; only used rows go on wire')
  assert.strictEqual(definition.wire.view(candidate), view)
}
assert.equal(definition.stateSchema.safeParse({ ...before, catalog: [...fullCatalog, entry] }).success, false)
assert.equal(definition.stateSchema.safeParse({ ...before, catalog: [{ name: '../office', description: 'bad' }] }).success, false)
assert.equal(definition.wire.viewSchema.safeParse({ ...definition.wire.view(before), rows: [{ ...before.rows[0], description: 'x'.repeat(limits.description + 1) }] }).success, false)
const frozenCatalog = Object.freeze({ ...before, rows: Object.freeze(before.rows.map(row => Object.freeze({ ...row }))), catalog: Object.freeze(before.catalog.map(item => Object.freeze({ ...item }))), pending: Object.freeze(before.pending.slice()) })
assert.doesNotThrow(() => apply(frozenCatalog, catalog(10, [])))
console.log('capabilities: pure-fold, catalog descriptions/replay/bounds and real Zod state/wire assertions passed')
