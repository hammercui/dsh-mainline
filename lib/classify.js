/**
 * Judgment: turn one tool execution into a scope verdict.
 *
 * The verdict vocabulary is fixed by the product (four levels) and the rules
 * are deliberately boring:
 *
 *   ⚪ display  — commands and reads are never judged. This plugin does not
 *                 grade `pwsh` or `read`; it only shows them.
 *   🔴 red      — a write whose target hits a forbidden glob (root-level red
 *                 lines always win over a milestone's allow list).
 *   🟢 green    — a write whose target is inside the active milestone's allow
 *                 list.
 *   🟡 yellow   — a write outside that list: the drift signal, and the only
 *                 thing this dashboard is really for.
 *
 * Nothing here can block anything: `decide()` is pure and its result is only
 * ever rendered.
 *
 * @module dsh-mainline/classify
 */
import { homedir } from 'node:os'

/** Known tool name → row variant, mirroring the GUI's own classification. */
export const TOOL_VARIANTS = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  read_image: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  write: 'write',
  edit: 'edit',
  run_code: 'code',
  cordis_package_inspect: 'read',
  cordis_runtime_inspect: 'read',
  cordis_run: 'others',
  cordis_stop: 'others',
  cordis_undefine: 'others',
}

const WRITE_VARIANTS = new Set(['write', 'edit'])
const DISPLAY_VARIANTS = new Set(['read', 'search', 'bash', 'code', 'others'])

/** Argument keys that carry the file a write lands on, in preference order. */
const PATH_KEYS = ['file_path', 'path', 'filePath', 'notebook_path', 'target_path', 'targetPath', 'dest', 'destination', 'output_path']

/** Names that look like a mutation; only trusted once a path was actually found. */
const WRITEISH_NAME = /(^|[_-])(write|edit|patch|create|delete|move|rename|mkdir|touch|save|replace)([_-]|$)|^(write|edit|apply_patch|multi_edit)$/i

const LEVEL_RANK = { green: 0, yellow: 1, red: 2 }

/**
 * Normalize a path or glob into a comparable, absolute, forward-slash,
 * lowercase string. `$WS` expands to the configured project root.
 * @param input - raw value from the config or from tool arguments.
 * @param root - the configured project root, if any.
 * @param home - account home used for `~` expansion.
 */
export function normalizePath(input, root, home = homedir()) {
  let text = String(input ?? '').trim().replace(/\\/g, '/')
  if (text === '') return ''
  if (text.startsWith('$WS')) text = `${(root ?? '').replace(/\\/g, '/')}${text.slice(3)}`
  else if (text === '~' || text.startsWith('~/')) text = `${home.replace(/\\/g, '/')}${text.slice(1)}`
  text = text.replace(/\/{2,}/g, '/').replace(/\/\.\//g, '/').replace(/\/+$/, '')
  return text.toLowerCase()
}

/** Whether a config entry is a glob rather than a plain path prefix. */
const isGlob = entry => /[*?[{]/.test(entry)

/**
 * Compile one glob to an anchored, case-insensitive RegExp.
 * Supports `**`, `*`, `?` and `{a,b}`; everything else is literal.
 * @param glob - the glob text (already normalized).
 */
export function globToRegExp(glob) {
  let source = ''
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]
    if (character === '*') {
      if (glob[index + 1] === '*') {
        index += 1
        if (glob[index + 1] === '/') {
          index += 1
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
    } else if (character === '?') {
      source += '[^/]'
    } else if (character === '{') {
      const end = glob.indexOf('}', index)
      if (end === -1) {
        source += '\\{'
      } else {
        const alternatives = glob.slice(index + 1, end).split(',').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        source += `(?:${alternatives.join('|')})`
        index = end
      }
    } else if ('\\^$.|+()[]'.includes(character)) {
      source += `\\${character}`
    } else {
      source += character
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

/** Per-rule compiled matcher cache; configs are re-read rarely, globs repeat a lot. */
const matcherCache = new Map()

/**
 * Build a predicate for one config entry.
 *
 * A non-glob entry matches as a path prefix as well as exactly, so
 * `D:/repo/src` covers everything under `src` without forcing `/**`.
 *
 * @param entry - one `allow`/`forbid` entry.
 * @param root - project root for `$WS`.
 * @param home - account home for `~`.
 * @returns a predicate over an already-normalized path.
 */
export function matcherFor(entry, root, home) {
  const normalized = normalizePath(entry, root, home)
  if (normalized === '') return () => false
  const key = `${normalized}\u0000${isGlob(normalized) ? 'glob' : 'prefix'}`
  const cached = matcherCache.get(key)
  if (cached !== undefined) return cached
  let predicate
  if (isGlob(normalized)) {
    const pattern = globToRegExp(normalized)
    predicate = path => pattern.test(path)
  } else {
    predicate = path => path === normalized || path.startsWith(`${normalized}/`)
  }
  if (matcherCache.size > 512) matcherCache.clear()
  matcherCache.set(key, predicate)
  return predicate
}

/**
 * Collect every file a tool execution targets.
 * @param name - wire tool name.
 * @param args - the tool's argument object.
 * @returns absolute-or-as-given paths, de-duplicated, at most 8.
 */
export function extractTargets(name, args) {
  const found = []
  if (typeof args !== 'object' || args === null) return found
  for (const key of PATH_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') found.push(value.trim())
  }
  if (Array.isArray(args.files)) {
    for (const entry of args.files) {
      if (typeof entry === 'string' && entry.trim() !== '') found.push(entry.trim())
      else if (entry !== null && typeof entry === 'object' && typeof entry.path === 'string') found.push(entry.path.trim())
    }
  }
  if (typeof args.patch === 'string') {
    for (const match of args.patch.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)) found.push(match[1].trim())
  }
  if (typeof args.filename === 'string' && args.filename.trim() !== '') found.push(args.filename.trim())
  return [...new Set(found.filter(Boolean))].slice(0, 8)
}

/** One-line human summary of what the call is doing, for the action card. */
export function summarize(variant, args, toolName) {
  const pick = keys => {
    for (const key of keys) {
      const value = args?.[key]
      if (typeof value === 'string' && value.trim() !== '') return value
    }
    return undefined
  }
  let text
  if (variant === 'search' && Array.isArray(args?.queries)) {
    const queries = args.queries.filter(query => typeof query === 'string' && query !== '')
    if (queries.length > 0) text = queries.join(', ')
  }
  if (text === undefined) {
    const keys = {
      bash: ['description', 'command'],
      read: ['file_path', 'path', 'url'],
      search: ['query', 'pattern', 'url'],
      write: ['file_path', 'path'],
      edit: ['file_path', 'path'],
      code: ['description'],
    }[variant] ?? []
    text = pick(keys)
  }
  if (text === undefined && typeof args === 'object' && args !== null) {
    for (const value of Object.values(args)) {
      if (typeof value === 'string' && value !== '') {
        text = value
        break
      }
    }
  }
  if (text === undefined) text = toolName
  const firstLine = text.split('\n')[0].trim()
  return firstLine.length > 180 ? `${firstLine.slice(0, 180)}…` : firstLine
}

/** Shortest sensible display form of a path: workspace-relative when inside. */
export function displayPath(path, root) {
  const normalizedRoot = (root ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const text = String(path ?? '').replace(/\\/g, '/')
  if (normalizedRoot !== '' && text.toLowerCase().startsWith(`${normalizedRoot}/`)) return text.slice(normalizedRoot.length + 1)
  return text
}

/** Which of the four levels a tool name maps to before any path logic. */
export function variantOf(name) {
  return TOOL_VARIANTS[name] ?? 'others'
}

function matchesAny(patterns, name) {
  if (patterns === undefined || patterns.length === 0) return false
  for (const pattern of patterns) {
    if (pattern === name) return true
    if (isGlob(pattern) && globToRegExp(normalizePath(pattern, null)).test(name.toLowerCase())) return true
  }
  return false
}

/**
 * Judge one execution.
 *
 * @param exec - `{ name, arguments }` from `tools/pre-execute`.
 * @param context - `{ config, root, home }`; `config` may be the last good one.
 * @returns the verdict the panel renders: level, reason, targets, summary.
 */
export function decide(exec, context) {
  const name = typeof exec?.name === 'string' ? exec.name : 'unknown'
  const args = exec?.arguments
  const config = context?.config ?? null
  const root = config?.root ?? context?.root ?? null
  const home = context?.home ?? homedir()
  const tools = config?.tools ?? { writes: [], commands: [], judge: [], display: [] }
  const variant = variantOf(name)

  const base = { tool: name, variant, summary: summarize(variant, args, name) }

  // 1. Explicit, config-owned overrides win over the built-in variant table.
  if (matchesAny(tools.display, name)) {
    return { ...base, level: 'display', reason: '按配置：只展示，不判定范围', targets: [] }
  }
  const forcedJudge = matchesAny(tools.judge, name)
  const forcedWrite = matchesAny(tools.writes, name)

  // 2. Commands are display-only by product decision, not by accident.
  if (!forcedJudge && !forcedWrite && variant === 'bash') {
    return { ...base, level: 'display', reason: '命令只展示，不判定范围', targets: [] }
  }
  // 3. Reads are never graded.
  if (!forcedJudge && !forcedWrite && (variant === 'read' || variant === 'search')) {
    return { ...base, level: 'display', reason: '读取只展示，不判定范围', targets: [] }
  }

  const rawTargets = extractTargets(name, args)
  const looksWriteish = WRITEISH_NAME.test(name) && rawTargets.length > 0
  const judged = forcedJudge || forcedWrite || WRITE_VARIANTS.has(variant) || looksWriteish

  if (!judged) {
    return { ...base, level: 'display', reason: '未纳入判定规则（只展示）', targets: [] }
  }

  if (config === null) {
    return { ...base, level: 'yellow', reason: '没有可用的范围配置，无法判定', targets: [] }
  }

  if (rawTargets.length === 0) {
    return { ...base, level: 'yellow', reason: '这是一个写入动作，但没能解析出目标路径', targets: [] }
  }

  const rootForbid = (config.rootForbid ?? []).map(entry => ({ entry, match: matcherFor(entry, root, home) }))
  const milestone = config.milestones.find(entry => entry.id === config.activeMilestoneId) ?? null
  const milestoneForbid = (milestone?.forbid ?? []).map(entry => ({ entry, match: matcherFor(entry, root, home) }))
  const milestoneAllow = (milestone?.allow ?? []).map(entry => ({ entry, match: matcherFor(entry, root, home) }))

  const targets = []
  for (const raw of rawTargets) {
    const normalized = normalizePath(raw, root, home)
    const display = displayPath(raw, root)
    const forbiddenBy = rootForbid.find(rule => rule.match(normalized)) ?? milestoneForbid.find(rule => rule.match(normalized))
    if (forbiddenBy !== undefined) {
      const scope = rootForbid.some(rule => rule.entry === forbiddenBy.entry) ? '项目红线' : `里程碑 ${milestone?.id ?? '?'} 禁止`
      targets.push({ path: display, level: 'red', reason: `${scope}：${forbiddenBy.entry}` })
      continue
    }
    const allowedBy = milestoneAllow.find(rule => rule.match(normalized))
    if (allowedBy !== undefined) {
      targets.push({ path: display, level: 'green', reason: `命中允许规则：${allowedBy.entry}` })
      continue
    }
    targets.push({ path: display, level: 'yellow', reason: milestone === null ? '没有活动里程碑，无允许清单' : `不在里程碑 ${milestone.id} 的允许清单内` })
  }

  let level = 'green'
  for (const target of targets) if (LEVEL_RANK[target.level] > LEVEL_RANK[level]) level = target.level
  const notable = targets.find(target => target.level === level) ?? targets[0]
  return { ...base, level, reason: notable.reason, targets }
}
