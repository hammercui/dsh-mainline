/**
 * Headless smoke test for the dashboard's core logic: config validation,
 * path/glob matching, judgment, and the alert merge. Run with plain node.
 *
 *   node .scratch/smoke.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decide, matcherFor, normalizePath } from '../lib/classify.js'
import { validateConfig as validate, ScopeConfig } from '../lib/config.js'
import { ScopeStore } from '../lib/store.js'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
    console.log(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual  : ${JSON.stringify(actual)}`)
  } else {
    console.log(`ok   ${label}`)
  }
}

// --- config validation -------------------------------------------------------
const good = validate({
  version: 1,
  project: 'demo',
  root: 'D:/work/demo',
  activeMilestone: 'M1',
  forbid: ['**/.env'],
  milestones: [
    { id: 'M1', title: '骨架', allow: ['$WS/**'], forbid: ['$WS/prod/**'], tasks: [{ id: 'M1-1', title: 't', acceptance: ['a'] }] },
  ],
})
check('good config validates', good.errors, undefined)
check('config activates declared milestone', good.config.activeMilestoneId, 'M1')

const bad = validate({ milestones: [{ id: 'M1', allow: [3] }, { id: 'M1' }], activeMilestone: 'M9' })
check('bad config reports every problem', bad.errors.length, 3)

const noMilestones = validate({ milestones: [] })
check('empty milestone list is valid', noMilestones.errors, undefined)

// --- glob semantics ----------------------------------------------------------
const root = 'D:/work/demo'
const m = (pattern, path) => matcherFor(pattern, root, 'C:/Users/x')(normalizePath(path, root, 'C:/Users/x'))
check('prefix entry covers the tree', m('$WS/src', 'D:/work/demo/src/a/b.js'), true)
check('prefix entry is not fooled by a sibling', m('$WS/src', 'D:/work/demo/src2/a.js'), false)
check('** matches at depth', m('$WS/**', 'D:/work/demo/a/b/c.ts'), true)
check('**/secrets/** matches nested', m('**/secrets/**', 'D:/work/demo/x/secrets/key.txt'), true)
check('**/secrets/** matches at root', m('**/secrets/**', 'D:/work/demo/secrets/key.txt'), true)
check('*.env only matches one segment', m('**/*.env', 'D:/work/demo/.env'), true)
check('{a,b} alternation', m('$WS/*.{ts,tsx}', 'D:/work/demo/x.tsx'), true)
check('case insensitive', m('$WS/SRC/**', 'd:/WORK/demo/src/a.ts'), true)

// --- judgment ---------------------------------------------------------------
const config = good.config
const judge = (name, args) => decide({ name, arguments: args }, { config, root })
check('read is display-only', judge('read', { file_path: 'D:/work/demo/a.ts' }).level, 'display')
check('pwsh is display-only', judge('pwsh', { command: 'Get-Date' }).level, 'display')
check('write inside allow is green', judge('write', { file_path: 'D:/work/demo/src/a.ts' }).level, 'green')
check('write outside allow is yellow', judge('write', { file_path: 'E:/elsewhere/a.ts' }).level, 'yellow')
check('write into root red line is red', judge('write', { file_path: 'D:/work/demo/.env' }).level, 'red')
check('milestone forbid beats allow', judge('edit', { file_path: 'D:/work/demo/prod/a.ts' }).level, 'red')
check('write without a path is yellow', judge('write', { content: 'x' }).level, 'yellow')
check('unknown non-file tool is display', judge('todo_write', { todos: [] }).level, 'display')
check('unknown file tool with a path is judged', judge('apply_patch', { patch: '*** Update File: D:/work/demo/src/a.ts\n' }).level, 'green')
check('apply_patch red line', judge('apply_patch', { patch: '*** Add File: D:/work/demo/.env\n' }).level, 'red')

// --- store ------------------------------------------------------------------
const store = new ScopeStore()
store.record(judge('write', { file_path: 'E:/x/a.ts' }), { token: 'a', milestone: 'M1' })
store.record(judge('write', { file_path: 'E:/x/a.ts' }), { token: 'b', milestone: 'M1' })
store.record(judge('pwsh', { command: 'ls' }), { token: 'c' })
check('alerts merge on the same target', store.alerts.length, 1)
check('merged alert counts', store.alerts[0].count, 2)
check('counts include display', store.counts.display, 1)
check('health drift ratio', store.health().driftRatio, 1)
store.settle('a', { failed: false, ms: 12 })
check('settled event leaves the running state', store.bySeq.get(1).state, 'done')
check('settle is idempotent', store.settle('a', {}), undefined)
check('snapshot newest-first', store.snapshot().events[0].seq, 3)

// --- per-session views -------------------------------------------------------
const store2 = new ScopeStore()
store2.record(judge('write', { file_path: 'D:/work/demo/src/a.ts' }), { session: 'sess-aaaa' })
store2.record(judge('write', { file_path: 'E:/x/b.ts' }), { session: 'sess-bbbb' })
store2.record(judge('write', { file_path: 'E:/x/b.ts' }), { session: 'sess-aaaa' })
check('global view sees every session', store2.snapshot().events.length, 3)
check('session view filters events', store2.viewFor('sess-aaaa').events.length, 2)
check('session current is its own', store2.viewFor('sess-bbbb').current.session, 'sess-bbbb')
check('session health is its own', store2.viewFor('sess-aaaa').health.judged, 2)
check('alerts track every contributing session', store2.viewFor('sess-bbbb').alerts[0].sessions, ['sess-bbbb', 'sess-aaaa'])
const patch = { type: 'patch', seq: 9, health: { x: 1 }, current: { session: 'sess-bbbb' }, event: { seq: 9, session: 'sess-bbbb' } }
check('frameFor drops foreign event parts', store2.frameFor(patch, 'sess-aaaa').event, undefined)
check('frameFor re-frames current', store2.frameFor(patch, 'sess-aaaa').current.session, 'sess-aaaa')
check('frameFor passes through unfiltered', store2.frameFor(patch, null).event.seq, 9)

// --- per-workspace config resolution ----------------------------------------
const tmpA = mkdtempSync(join(tmpdir(), 'ml-a-'))
const tmpB = mkdtempSync(join(tmpdir(), 'ml-b-'))
mkdirSync(join(tmpA, '.dsh'), { recursive: true })
writeFileSync(join(tmpA, '.dsh', 'mainline.json'), JSON.stringify({ project: 'A', root: '.', milestones: [{ id: 'A1' }] }))
mkdirSync(join(tmpB, '.dsh'), { recursive: true })
writeFileSync(join(tmpB, '.dsh', 'mainline.json'), JSON.stringify({ project: 'B', root: '.', milestones: [{ id: 'B1' }] }))
const cfg = new ScopeConfig({ cwd: join(tmpdir(), 'ml-nowhere'), home: join(tmpdir(), 'ml-nohome') })
check('workspace A resolves its own project', cfg.viewFor(tmpA).document.project, 'A')
check('workspace B resolves its own project', cfg.viewFor(tmpB).document.project, 'B')
check('workspace B sees no A milestones', cfg.viewFor(tmpB).document.milestones.some(x => x.id === 'A1'), false)
check('viewFor caches by mtime', cfg.viewFor(tmpA) !== null, true)
cfg.dispose()
rmSync(tmpA, { recursive: true, force: true })
rmSync(tmpB, { recursive: true, force: true })

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
