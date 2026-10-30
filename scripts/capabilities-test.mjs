import assert from 'node:assert/strict'
import { z } from 'zod'
import { initialCapabilities as init, applyCapabilities as apply, CAPABILITIES_LIMITS as limits, createCapabilitiesProjection } from '../lib/capabilities.js'
const call = (seq, id, name = 'skill', args = '{"name":"office"}', turn = 1) => ({ seq, type: 'tool/call', data: { turn, step: 1, callId: id, name, arguments: args } })
const result = (seq, id, code, text = '<skill_content name="office">instructions</skill_content>', turn = 1) => ({ seq, type: 'tool/result', data: {
  turn, step: 1, message: { toolCallId: id, isError: Boolean(code), content: [{ type: 'text', text }] }, ...(code ? { error: { name: 'Error', code } } : {}),
} })
const start = (seq, turn = 1) => ({ seq, type: 'turn/start', data: { turn } })
const end = (seq, turn = 1, reason = { kind: 'interrupted' }) => ({ seq, type: 'turn/end', data: { turn, reason } })
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
assert.deepEqual(init(), { rows: [], pending: [], catalog: [], awaitingTurn: [], currentTurn: null, turnRunning: false, dropped: 0, lastSeq: -1 }, 'session isolation')
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
assert.equal(definition.stateVersion, 6)
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
// Turn-scoped delivery evidence, not proof of instruction adherence/context retention.
const runningEvents = [catalog(0), start(1, 7), call(2, 'current', 'skill', '{"name":"office"}', 7), result(3, 'current', null, undefined, 7)]
const running = fold(runningEvents)
assert.equal(running.currentTurn, 7)
assert.equal(running.turnRunning, true)
assert.equal(running.rows[0].loadedTurn, 7)
assert.equal(running.rows[0].description, officeDescription)
const ended = apply(running, end(4, 7, { kind: 'completed' }))
assert.equal(ended.turnRunning, false, 'end changes state even without pending calls')
assert.equal(ended.rows[0].loadedTurn, 7)
const nextTurn = apply(ended, start(5, 12))
assert.equal(nextTurn.currentTurn, 12, 'use observed number, not inferred increment')
assert.equal(nextTurn.rows[0].loadedTurn, 7, 'previous successful evidence is historical')
assert.strictEqual(apply(nextTurn, end(6, 7)), nextTurn, 'stale closer cannot end another turn')
assert.strictEqual(apply(nextTurn, start(6, 12)), nextTurn, 'duplicate start cannot reset evidence')
assert.strictEqual(apply(nextTurn, start(6, 3)), nextTurn, 'older start ignored')
for (const bad of [null, '12', -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.strictEqual(apply(nextTurn, start(10, bad)), nextTurn)
  assert.strictEqual(apply(nextTurn, end(10, bad)), nextTurn)
}
const failedReloads = []
for (const code of ['TOOL_TIMEOUT', 'ABORTED', 'ABORTED_BEFORE_DISPATCH', 'UNKNOWN_TOOL']) {
  const retry = fold([call(4, 'retry', 'skill', undefined, 7), result(5, 'retry', code, undefined, 7)], running)
  assert.equal(retry.rows[0].loadedTurn, 7, 'a failed retry never revokes earlier successful delivery')
  assert.equal(retry.rows[0].succeeded, 1)
  failedReloads.push(retry)
}
const unverifiedReload = fold([call(4, 'unverified', 'skill', undefined, 7), result(5, 'unverified', null, 'not instructions', 7)], running)
assert.equal(unverifiedReload.rows[0].loadedTurn, 7)
const concurrent = fold([call(4, 'x', 'skill', undefined, 7), call(5, 'y', 'skill', undefined, 7), result(6, 'y', null, undefined, 7)], running)
assert.equal(concurrent.rows[0].pending, 1, 'one settled concurrent load does not hide another pending load')
assert.equal(concurrent.rows[0].loadedTurn, 7)
const concurrentFailed = apply(concurrent, result(7, 'x', 'TOOL_TIMEOUT', undefined, 7))
assert.equal(concurrentFailed.rows[0].pending, 0)
assert.equal(concurrentFailed.rows[0].loadedTurn, 7)
const canceled = apply(concurrent, end(7, 7, { kind: 'aborted', reason: { kind: 'user' } }))
assert.equal(canceled.turnRunning, false)
assert.equal(canceled.rows[0].pending, 0)
assert.equal(canceled.rows[0].interrupted, 1)
assert.equal(canceled.rows[0].loadedTurn, 7)
assert.strictEqual(apply(canceled, result(8, 'x', null, undefined, 7)), canceled, 'late result cannot revive canceled call')
const missingEnd = apply(concurrent, start(7, 8))
assert.equal(missingEnd.rows[0].pending, 0)
assert.equal(missingEnd.rows[0].loadedTurn, 7)
assert.strictEqual(apply(missingEnd, result(8, 'x', null, undefined, 7)), missingEnd)
assert.strictEqual(apply(concurrent, result(7, 'x', null, undefined, 8)), concurrent, 'result from wrong turn cannot settle pending call')
const preStart = fold([user])
assert.equal(preStart.rows[0].loadedTurn, null, 'idle invocation must not guess turn number')
assert.deepEqual(preStart.awaitingTurn, ['office'])
const admitted = apply(preStart, start(1, 9))
assert.equal(admitted.rows[0].loadedTurn, 9)
assert.deepEqual(admitted.awaitingTurn, [])
assert.equal(apply(apply(admitted, end(2, 9)), start(3, 10)).rows[0].loadedTurn, 9, 'idle load binds once only')
const between = apply(ended, { ...user, seq: 5 })
assert.equal(between.rows[0].loadedTurn, 7, 'pre-start reload preserves last successful known turn')
assert.equal(apply(between, start(6, 12)).rows[0].loadedTurn, 12)
const within = fold([start(0, 4), { ...user, seq: 1 }])
assert.equal(within.rows[0].loadedTurn, 4, 'installed pre-step ordering binds running turn')
assert.deepEqual(within.awaitingTurn, [])
const unknownCall = call(0, 'unknown'); delete unknownCall.data.turn
const unknownResult = result(1, 'unknown'); delete unknownResult.data.turn
const unknown = fold([unknownCall, unknownResult])
assert.equal(unknown.rows[0].loadedTurn, null, 'legacy missing turn remains unknown, not current')
assert.equal(unknown.turnRunning, false, 'tool activity alone cannot establish running lifecycle')
let queued = init()
for (let i = 0; i < limits.rows + 30; i++) queued = apply(queued, { ...user, seq: i, data: { source: { ...user.data.source, name: `skill-${i}` } } })
assert.equal(queued.awaitingTurn.length, limits.rows, 'pre-start names share row eviction bound')
assert.equal(queued.awaitingTurn.includes('skill-0'), false)
const queuedStarted = apply(queued, start(limits.rows + 31, 45))
assert.ok(queuedStarted.rows.every(row => row.loadedTurn === 45))
const lifecycleEvents = [{ ...user, seq: 0 }, start(1, 7), call(2, 'a', 'skill', undefined, 7), result(3, 'a', null, undefined, 7), call(4, 'b', 'skill', undefined, 7), call(5, 'c', 'skill', undefined, 7), result(6, 'c', 'TOOL_TIMEOUT', undefined, 7), end(7, 7), { ...user, seq: 8 }, start(9, 8), end(10, 8), start(11, 9)]
const lifecycle = fold(lifecycleEvents)
for (let split = 0; split <= lifecycleEvents.length; split++) {
  assert.deepEqual(fold(lifecycleEvents.slice(split), JSON.parse(JSON.stringify(fold(lifecycleEvents.slice(0, split))))), lifecycle, 'every lifecycle checkpoint replays deterministically')
}
assert.deepEqual(fold(lifecycleEvents), lifecycle)
const activityStates = [running, ended, nextTurn, concurrent, concurrentFailed, canceled, missingEnd, preStart, admitted, between, within, unknown, queued, queuedStarted, lifecycle, unverifiedReload, ...failedReloads]
for (const candidate of activityStates) {
  assert.deepEqual(definition.stateSchema.parse(candidate), candidate)
  const view = definition.wire.view(candidate)
  assert.deepEqual(definition.wire.viewSchema.parse(view), view)
  assert.equal(view.currentTurn, candidate.currentTurn)
  assert.equal(view.turnRunning, candidate.turnRunning)
  assert.equal('awaitingTurn' in view, false)
  assert.ok(!JSON.stringify(view).includes('callId'))
}
const immutablePreStart = Object.freeze({ ...preStart, rows: Object.freeze(preStart.rows.map(row => Object.freeze({ ...row }))), awaitingTurn: Object.freeze(preStart.awaitingTurn.slice()) })
assert.doesNotThrow(() => apply(immutablePreStart, start(1, 9)))
assert.equal(preStart.rows[0].loadedTurn, null)
// Loaded text is an approximation, never per-skill billing. Include wrappers.
const payload = '<skill_content name="office">abcd中文😀</skill_content>'
const expectedTokens = Math.ceil((payload.length - 4) / 4 + 3) // emoji is two UTF-16 units, one code point
const multiResult = result(1, 'tokens', null, payload)
multiResult.data.message.content.push({ type: 'image', text: 'ignored private image' }, { type: 'text', text: 'abcd' })
const tokenEvents = [call(0, 'tokens', 'skill', '{"name":"office","private":"do not estimate arguments"}'), multiResult,
  { ...user, seq: 2, data: { ...user.data, content: [{ type: 'text', text: 'abcd中文😀' }] } },
  call(3, 'failed'), result(4, 'failed', 'TOOL_TIMEOUT', payload),
  call(5, 'repeat'), result(6, 'repeat', null, payload)]
const tokens = fold(tokenEvents)
assert.equal(fold(tokenEvents.slice(0, 2)).rows[0].latestLoadTokens, expectedTokens + 1, 'all text blocks, no image or argument text')
assert.equal(fold(tokenEvents.slice(0, 3)).rows[0].latestLoadTokens, 4, 'mixed scripts counted by code point, not UTF-16 length')
assert.equal(fold(tokenEvents.slice(0, 5)).rows[0].latestLoadTokens, 4, 'errors do not replace latest verified load')
assert.equal(tokens.rows[0].latestLoadTokens, expectedTokens)
assert.equal(tokens.rows[0].totalLoadTokens, expectedTokens * 2 + 5)
assert.equal(tokens.rows[0].unknownLoads, 0)
assert.equal(tokens.rows[0].latestLoadTokenStatus, 'complete')
assert.equal(tokens.rows[0].tokenEstimateMethod, 'ascii-4-nonascii-1-v1')
assert.equal(mcp.rows[0].tokenEstimateMethod, null)
assert.equal(mcp.rows[0].totalLoadTokens, null)
assert.equal(fold([user]).rows[0].latestLoadTokens, null, 'missing successful user payload is unknown')
assert.equal(fold([user]).rows[0].unknownLoads, 1)
const emptyUser = { ...user, data: { ...user.data, content: [{ type: 'text', text: '' }] } }
assert.equal(fold([emptyUser]).rows[0].totalLoadTokens, null, 'empty is unknown, never zero')
assert.equal(fold([call(0, 'empty'), result(1, 'empty', null, '')]).rows[0].latestLoadTokens, null)
for (const error of ['TOOL_TIMEOUT', 'ABORTED', 'UNKNOWN_TOOL']) {
  const errorRow = fold([call(0, 'error'), result(1, 'error', error, payload)]).rows[0]
  assert.equal(errorRow.totalLoadTokens, null)
  assert.equal(errorRow.unknownLoads, 0, 'failed calls are not unknown successful loads')
}
const userText = text => ({ ...user, data: { ...user.data, content: [{ type: 'text', text }] } })
const exactBound = fold([userText('a'.repeat(limits.loadText))])
assert.equal(exactBound.rows[0].latestLoadTokens, Math.ceil(limits.loadText / 4))
const overBound = fold([userText('a'.repeat(limits.loadText + 1))])
assert.equal(overBound.rows[0].latestLoadTokens, null)
assert.equal(overBound.rows[0].totalLoadTokens, null)
assert.equal(overBound.rows[0].latestLoadTokenStatus, 'truncated')
assert.equal(overBound.rows[0].unknownLoads, 1)
const overBlocks = result(1, 'oversize', null, payload)
overBlocks.data.message.content.push({ type: 'text', text: 'a'.repeat(limits.loadText) })
const boundedResult = fold([call(0, 'oversize'), overBlocks])
assert.equal(boundedResult.rows[0].succeeded, 1)
assert.equal(boundedResult.rows[0].latestLoadTokenStatus, 'truncated', 'aggregate all text-block lengths before counting')
const manyBlocks = { ...user, data: { ...user.data, content: Array(limits.loadText + 1).fill({ type: 'image' }) } }
assert.equal(fold([manyBlocks]).rows[0].latestLoadTokenStatus, 'truncated', 'block traversal also bounded')
const unknownAfterKnown = apply(tokens, { ...emptyUser, seq: 7 })
assert.equal(unknownAfterKnown.rows[0].latestLoadTokens, null)
assert.equal(unknownAfterKnown.rows[0].totalLoadTokens, tokens.rows[0].totalLoadTokens, 'known sum survives unknown load; unknownLoads discloses incompleteness')
assert.equal(unknownAfterKnown.rows[0].unknownLoads, 1)
assert.equal(apply(tokens, catalog(7)).rows[0].totalLoadTokens, tokens.rows[0].totalLoadTokens, 'catalog not estimated')
for (let split = 0; split <= tokenEvents.length; split++) {
  assert.deepEqual(fold(tokenEvents.slice(split), JSON.parse(JSON.stringify(fold(tokenEvents.slice(0, split))))), tokens, 'token checkpoint replay')
}
for (const candidate of [tokens, exactBound, overBound, boundedResult, unknownAfterKnown, fold([emptyUser])]) {
  assert.deepEqual(definition.stateSchema.parse(candidate), candidate)
  const view = definition.wire.view(candidate)
  assert.deepEqual(definition.wire.viewSchema.parse(view), view)
  const serialized = JSON.stringify({ candidate, view })
  for (const secret of [payload, 'do not estimate arguments', 'ignored private image', 'abcd中文😀', 'a'.repeat(100)]) assert.ok(!serialized.includes(secret), 'no loaded raw text persisted or on wire')
}
assert.equal(definition.stateSchema.safeParse({ ...tokens, rows: [{ ...tokens.rows[0], latestLoadTokens: -1 }] }).success, false)
assert.equal(definition.stateSchema.safeParse({ ...tokens, rows: [{ ...tokens.rows[0], tokenEstimateMethod: 'actual-billing' }] }).success, false)
// Regression: hot updates must replace the old stylesheet rather than skip it.
const { readFileSync } = await import('node:fs')
const { runInNewContext } = await import('node:vm')
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const cssStart = client.indexOf('    const STYLE_ID =')
const cssEnd = client.indexOf('    const h = React.createElement', cssStart)
const style = { textContent: 'old stylesheet' }
runInNewContext(`${client.slice(cssStart, cssEnd)}; ensureStyle()`, {
  document: { getElementById: () => style },
})
assert.ok(style.textContent.includes('.sd-cap-list { display: flex;'))
assert.ok(style.textContent.includes('list-style: none'))
assert.ok(style.textContent.includes('--dsw-alias-state-warn-primary'))
assert.ok(client.includes("h('style', null, CSS_TEXT)"), 'capability component owns current styles')
const statusStart = client.indexOf('    function capabilityStatus(')
const statusEnd = client.indexOf('    function CapabilityItem(', statusStart)
assert.ok(statusStart >= 0 && statusEnd > statusStart)
const statusOf = runInNewContext(`${client.slice(statusStart, statusEnd)}; capabilityStatus`)
assert.equal(statusOf(running.rows[0], running).tone, 'active')
assert.equal(statusOf(running.rows[0], running).pulse, true)
assert.equal(statusOf(ended.rows[0], ended).tone, 'active')
assert.equal(statusOf(ended.rows[0], ended).pulse, false)
assert.equal(statusOf(nextTurn.rows[0], nextTurn).tone, 'idle')
assert.equal(statusOf(nextTurn.rows[0], nextTurn).pulse, false)
assert.equal(statusOf(concurrent.rows[0], concurrent).tone, 'busy', 'pending blue precedes successful evidence')
assert.equal(statusOf(unknown.rows[0], unknown).tone, 'idle')
assert.equal(statusOf(unknown.rows[0], unknown).pulse, false)
for (const retry of [...failedReloads, concurrentFailed, unverifiedReload]) {
  assert.equal(statusOf(retry.rows[0], retry).tone, 'active', 'latest failure cannot visually revoke current success')
  assert.equal(statusOf(retry.rows[0], retry).pulse, true)
}
assert.equal(statusOf(canceled.rows[0], canceled).pulse, false)
const failedOnly = fold([start(0), call(1, 'only'), result(2, 'only', 'TOOL_TIMEOUT')])
assert.equal(statusOf(failedOnly.rows[0], failedOnly).tone, 'attention')
assert.ok(style.textContent.includes('@media (prefers-reduced-motion: reduce)'))
assert.ok(style.textContent.includes('animation: none; opacity: 1;'))
const outOfOrder = fold([call(0, 'new', 'skill', undefined, 8), call(1, 'old', 'skill', undefined, 7), result(2, 'new', null, undefined, 8), result(3, 'old', null, undefined, 7)])
assert.equal(outOfOrder.rows[0].loadedTurn, 8, 'late old-turn success never regresses latest load turn')
// Latest successful delivery is its own event coordinate, not latest attempt/task.
assert.equal(state.rows[0].loadSeq, 3)
assert.equal(state.rows[0].loadSource, 'model')
assert.equal(preStart.rows[0].loadSeq, 0)
assert.equal(preStart.rows[0].loadSource, 'user')
assert.equal(admitted.rows[0].loadSeq, 0, 'turn binding does not replace delivery seq')
assert.equal(within.rows[0].loadSeq, 1)
assert.equal(unknown.rows[0].loadSeq, 1, 'successful legacy result has seq even without turn')
assert.equal(mcp.rows[0].loadSeq, null)
assert.equal(mcp.rows[0].loadSource, null)
assert.equal(failedOnly.rows[0].loadSeq, null)
assert.equal(failedOnly.rows[0].loadSource, null)
for (const retry of [...failedReloads, unverifiedReload, canceled, missingEnd]) {
  assert.equal(retry.rows[0].loadSeq, retry === canceled || retry === missingEnd ? 6 : 3)
  assert.equal(retry.rows[0].loadSource, 'model')
}
assert.equal(concurrentFailed.rows[0].loadSeq, 6, 'failure preserves most recent concurrent success')
assert.equal(outOfOrder.rows[0].loadSeq, 3, 'seq records latest delivery even when known loadedTurn does not regress')
assert.equal(tokens.rows[0].loadSeq, 6)
assert.equal(tokens.rows[0].loadSource, 'model')
assert.equal(unknownAfterKnown.rows[0].loadSeq, 7, 'unknown token estimate still delivered successfully')
assert.equal(unknownAfterKnown.rows[0].loadSource, 'user')
const userRetryEvents = [user, call(1, 'retry-user'), result(2, 'retry-user', 'TOOL_TIMEOUT')]
const userRetry = fold(userRetryEvents)
assert.equal(userRetry.rows[0].loadSeq, 0)
assert.equal(userRetry.rows[0].loadSource, 'user')
for (let split = 0; split <= userRetryEvents.length; split++) {
  assert.deepEqual(fold(userRetryEvents.slice(split), JSON.parse(JSON.stringify(fold(userRetryEvents.slice(0, split))))), userRetry)
}
for (const schema of [definition.stateSchema, definition.wire.viewSchema]) {
  const candidate = schema === definition.stateSchema ? userRetry : definition.wire.view(userRetry)
  assert.deepEqual(schema.parse(candidate), candidate)
  for (const loadSeq of [-1, 1.5, '0', Number.MAX_SAFE_INTEGER + 1]) assert.equal(schema.safeParse({ ...candidate, rows: [{ ...candidate.rows[0], loadSeq }] }).success, false)
  assert.equal(schema.safeParse({ ...candidate, rows: [{ ...candidate.rows[0], loadSource: 'inferred' }] }).success, false)
  const legacyRow = { ...candidate.rows[0] }; delete legacyRow.loadSeq; delete legacyRow.loadSource
  assert.equal(schema.safeParse({ ...candidate, rows: [legacyRow] }).success, false, 'v6 requires explicit evidence fields')
}
console.log('capabilities: projection/catalog/schema, turn lifecycle/replay/concurrency/cancel, pure UI status and stylesheet assertions passed')
