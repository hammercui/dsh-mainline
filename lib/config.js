/**
 * Scope configuration: discovery, strict validation, and hot reload.
 *
 * The config is the ONLY thing this plugin reads that the user writes. It is
 * never written back: the dashboard is read-only by contract, so every
 * resolution path here is a read plus a watch.
 *
 * A parse/validation failure never destroys the last good config — the
 * panel keeps judging against it and shows the exact error (line/column for
 * JSON syntax, a field path for schema errors) until the file is fixed.
 *
 * @module dsh-mainline/config
 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** File name the dashboard looks for inside a `.dsh` directory. */
export const CONFIG_FILENAME = 'mainline.json'

/** Pre-rename name, still honored at lower priority so existing projects keep working. */
export const LEGACY_CONFIG_FILENAME = 'scope-drift.json'

/** How often the watched file is stat'ed (ms). fs.watch is unreliable for
 *  editors that replace instead of append, so the poller is the primary path. */
const WATCH_INTERVAL_MS = 500

/**
 * The two static priority tiers.
 *
 * `explicit` comes from the profile row (`configFile`) or the
 * `DSH_SCOPE_DRIFT_CONFIG` environment variable; `host` is the fallback set
 * rooted at the host process. Workspace-derived candidates are inserted
 * between them at runtime by {@link ScopeConfig#considerWorkspace}.
 *
 * @param options - cwd plus an optional explicit path from the plugin config.
 * @returns `{ explicit, host }`, each already absolute.
 */
export function configCandidates(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const home = options.home ?? homedir()
  const explicit = []
  if (typeof options.configFile === 'string' && options.configFile.trim() !== '') {
    explicit.push(resolve(cwd, options.configFile.trim()))
  }
  const env = process.env.DSH_MAINLINE_CONFIG ?? process.env.DSH_SCOPE_DRIFT_CONFIG
  if (typeof env === 'string' && env.trim() !== '') explicit.push(resolve(cwd, env.trim()))
  const host = [
    join(cwd, '.dsh', CONFIG_FILENAME),
    join(cwd, '.dsh', LEGACY_CONFIG_FILENAME),
    join(cwd, CONFIG_FILENAME),
    join(home, '.dsh', CONFIG_FILENAME),
  ]
  return { explicit: [...new Set(explicit)], host: [...new Set(host)] }
}

/** Pick the first candidate that exists; otherwise the first candidate. */
export function pickConfigPath(candidates) {
  for (const candidate of candidates) {
    try {
      statSync(candidate)
      return { path: candidate, exists: true }
    } catch {
      /* keep looking */
    }
  }
  return { path: candidates[0], exists: false }
}

/**
 * The config locations derived from one workspace root, in priority order.
 * Shared by the global watcher ({@link ScopeConfig#considerWorkspace}) and the
 * per-session resolver ({@link ScopeConfig#viewFor}) so both agree on where a
 * project may place its roadmap.
 */
export function workspaceConfigPaths(dir) {
  return [
    join(dir, '.dsh', CONFIG_FILENAME),
    join(dir, '.dsh', LEGACY_CONFIG_FILENAME),
    join(dir, CONFIG_FILENAME),
  ]
}

/** Planning docs a project commonly starts with, most-canonical first. */
const SOURCE_DOC_NAMES = ['roadmap.md', 'ROADMAP.md', 'docs/roadmap.md', 'docs/ROADMAP.md']

/**
 * Find the project's planning document (`roadmap.md` by any common spelling).
 *
 * The dashboard never reads or parses it — prose is the human plan and the
 * JSON config is the machine-viewable mirror. The hint only lets the panel
 * offer a one-sentence import to the Agent when a fresh project already has
 * its plan written down.
 */
export function findSourceDoc(dir) {
  for (const rel of SOURCE_DOC_NAMES) {
    const path = join(dir, ...rel.split('/'))
    try {
      const mtimeMs = statSync(path).mtimeMs
      return { path, mtimeMs }
    } catch {
      /* keep looking */
    }
  }
  return null
}

/**
 * Turn a JSON.parse failure into a line/column pair plus the offending line.
 * @param text - the file contents that failed to parse.
 * @param error - the SyntaxError JSON.parse threw.
 */
export function describeJsonError(text, error) {
  const message = error instanceof Error ? error.message : String(error)
  const position = /position (\d+)/.exec(message)
  if (position === null) return { message }
  const offset = Math.min(Number(position[1]), text.length)
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  const column = offset - before.lastIndexOf('\n')
  const source = text.split('\n')[line - 1] ?? ''
  return { message, line, column, source: source.length > 200 ? `${source.slice(0, 200)}…` : source }
}

const isString = value => typeof value === 'string'
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

function stringList(value, at, errors, { required = false } = {}) {
  if (value === undefined) {
    if (required) errors.push(`${at}: 缺少该字段（期望字符串数组）`)
    return []
  }
  if (!Array.isArray(value)) {
    errors.push(`${at}: 期望字符串数组，实际是 ${describeType(value)}`)
    return []
  }
  const out = []
  value.forEach((entry, index) => {
    if (!isString(entry) || entry.trim() === '') {
      errors.push(`${at}[${index}]: 期望非空字符串，实际是 ${describeType(entry)}`)
      return
    }
    out.push(entry.trim())
  })
  return out
}

function describeType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Node states the roadmap renders: hollow / pulsing head / solid. */
const STATUS_VALUES = new Set(['todo', 'doing', 'done'])

function parseStatus(value, at, errors) {
  if (value === undefined || value === null) return null
  if (!isString(value) || !STATUS_VALUES.has(value.trim())) {
    errors.push(`${at}: 期望 todo | doing | done，实际是 ${describeType(value)}`)
    return null
  }
  return value.trim()
}

/**
 * Validate a parsed config document.
 *
 * Every problem is collected (capped) instead of throwing on the first one, so
 * a single look at the panel lists everything that is wrong with the file.
 *
 * @param raw - the parsed JSON value.
 * @returns `{ config }` on success, `{ errors }` otherwise. `errors` are
 *   user-facing Chinese strings that name the exact field path.
 */
export function validateConfig(raw) {
  const errors = []
  if (!isObject(raw)) {
    return { errors: [`根节点必须是 JSON 对象，实际是 ${describeType(raw)}`] }
  }
  const project = isString(raw.project) && raw.project.trim() !== '' ? raw.project.trim() : null
  if (raw.project !== undefined && project === null) errors.push('project: 期望非空字符串')
  const root = isString(raw.root) && raw.root.trim() !== '' ? raw.root.trim() : null
  if (raw.root !== undefined && root === null) errors.push('root: 期望非空字符串（用于 $WS 变量）')

  const milestonesRaw = raw.milestones
  if (milestonesRaw === undefined) {
    errors.push('milestones: 缺少该字段（期望数组，可为空数组）')
  } else if (!Array.isArray(milestonesRaw)) {
    errors.push(`milestones: 期望数组，实际是 ${describeType(milestonesRaw)}`)
  }

  const milestones = []
  if (Array.isArray(milestonesRaw)) {
    const seen = new Set()
    milestonesRaw.forEach((entry, index) => {
      const at = `milestones[${index}]`
      if (!isObject(entry)) {
        errors.push(`${at}: 期望对象，实际是 ${describeType(entry)}`)
        return
      }
      if (!isString(entry.id) || entry.id.trim() === '') {
        errors.push(`${at}.id: 期望非空字符串`)
        return
      }
      const id = entry.id.trim()
      if (seen.has(id)) errors.push(`${at}.id: 重复的里程碑 id "${id}"`)
      seen.add(id)
      const milestoneStatus = parseStatus(entry.status, `${at}.status`, errors)
      if (entry.key !== undefined && typeof entry.key !== 'boolean') errors.push(`${at}.key: 期望布尔值`)
      const isKey = entry.key === true
      const tasks = []
      if (entry.tasks !== undefined) {
        if (!Array.isArray(entry.tasks)) errors.push(`${at}.tasks: 期望数组，实际是 ${describeType(entry.tasks)}`)
        else {
          entry.tasks.forEach((task, taskIndex) => {
            const taskAt = `${at}.tasks[${taskIndex}]`
            if (!isObject(task)) {
              errors.push(`${taskAt}: 期望对象，实际是 ${describeType(task)}`)
              return
            }
            tasks.push({
              id: isString(task.id) && task.id.trim() !== '' ? task.id.trim() : `${id}-${taskIndex + 1}`,
              title: isString(task.title) ? task.title.trim() : '',
              status: parseStatus(task.status, `${taskAt}.status`, errors),
              acceptance: stringList(task.acceptance, `${taskAt}.acceptance`, errors),
            })
          })
        }
      }
      milestones.push({
        id,
        title: isString(entry.title) ? entry.title.trim() : '',
        explicitStatus: milestoneStatus,
        key: isKey,
        allow: stringList(entry.allow, `${at}.allow`, errors),
        forbid: stringList(entry.forbid, `${at}.forbid`, errors),
        tasks,
      })
    })
  }

  const activeMilestoneRaw = raw.activeMilestone
  let activeMilestoneId = null
  if (activeMilestoneRaw !== undefined) {
    if (!isString(activeMilestoneRaw) || activeMilestoneRaw.trim() === '') {
      errors.push('activeMilestone: 期望非空字符串')
    } else {
      activeMilestoneId = activeMilestoneRaw.trim()
    }
  }
  if (activeMilestoneId === null && milestones.length > 0) activeMilestoneId = milestones[0].id
  if (activeMilestoneId !== null && milestones.length > 0 && !milestones.some(m => m.id === activeMilestoneId)) {
    errors.push(`activeMilestone: 未在 milestones 中找到 id "${activeMilestoneId}"`)
  }

  let activeTaskId = null
  if (raw.activeTask !== undefined) {
    if (!isString(raw.activeTask) || raw.activeTask.trim() === '') errors.push('activeTask: 期望非空字符串')
    else activeTaskId = raw.activeTask.trim()
  }

  // Derive the roadmap states the map renders. An explicit `status` always
  // wins; otherwise `activeTask` marks the head ("你在这里"), and a milestone
  // with every task done reads as done, one with work under way as doing.
  for (const milestone of milestones) {
    for (const task of milestone.tasks) {
      if (task.status === null && activeTaskId !== null && task.id === activeTaskId) task.status = 'doing'
      if (task.status === null) task.status = 'todo'
    }
    if (milestone.explicitStatus !== null) {
      milestone.status = milestone.explicitStatus
    } else if (milestone.tasks.length > 0 && milestone.tasks.every(task => task.status === 'done')) {
      milestone.status = 'done'
    } else if (milestone.tasks.some(task => task.status === 'doing')) {
      milestone.status = 'doing'
    } else {
      milestone.status = 'todo'
    }
    delete milestone.explicitStatus
  }

  const toolsRaw = isObject(raw.tools) ? raw.tools : {}
  if (raw.tools !== undefined && !isObject(raw.tools)) errors.push(`tools: 期望对象，实际是 ${describeType(raw.tools)}`)
  const tools = {
    writes: stringList(toolsRaw.writes, 'tools.writes', errors),
    commands: stringList(toolsRaw.commands, 'tools.commands', errors),
    judge: stringList(toolsRaw.judge, 'tools.judge', errors),
    display: stringList(toolsRaw.display, 'tools.display', errors),
  }

  if (errors.length > 0) {
    const shown = errors.slice(0, 12)
    if (errors.length > shown.length) shown.push(`…还有 ${errors.length - shown.length} 条错误未显示`)
    return { errors: shown }
  }

  return {
    config: {
      project,
      root,
      activeMilestoneId,
      activeTaskId,
      rootForbid: stringList(raw.forbid, 'forbid', []),
      milestones,
      tools,
    },
  }
}

/**
 * Read + validate one config file.
 * @param path - absolute path.
 * @returns a load result; `status` is `ok` only when the file parsed AND
 *   validated, and `error` is present exactly when it did not.
 */
export function readConfig(path, exists) {
  if (!exists) return { status: 'missing', path }
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { status: 'error', path, error: { message: `读取失败：${error instanceof Error ? error.message : String(error)}` } }
  }
  let raw
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    return { status: 'error', path, error: describeJsonError(text, error) }
  }
  const result = validateConfig(raw)
  if (result.errors !== undefined) return { status: 'error', path, error: { message: result.errors.join('\n'), errors: result.errors } }
  return { status: 'ok', path, config: result.config }
}

/** The last-good configuration plus the live file status the panel renders. */
export class ScopeConfig {
  /**
   * @param options - explicit configFile from the plugin row, plus process
   *   facts (cwd/home) that tests override.
   */
  constructor(options = {}) {
    // Three priority tiers, so a workspace discovered later slots in between
    // an explicitly configured file and the process-wide fallbacks.
    const tiers = configCandidates(options)
    this.explicit = tiers.explicit
    this.hostFallback = tiers.host
    this.workspaceCandidates = []
    const picked = pickConfigPath(this.candidates)
    this.path = picked.path
    this.exists = picked.exists
    this.loadedAt = null
    this.config = null
    this.status = 'missing'
    this.error = null
    this.mtimeMs = 0
    this.listeners = new Set()
    this.timer = null
    /** path → { mtimeMs, view } for the per-workspace resolver. */
    this.viewCache = new Map()
  }

  /** Candidate paths in priority order; workspace-derived ones sit in the middle. */
  get candidates() {
    return [...this.explicit, ...this.workspaceCandidates, ...this.hostFallback]
  }

  /**
   * Offer the observed agent's workspace as a config location.
   *
   * This is what makes the dashboard work without any per-machine setup: the
   * panel watches the project the agent is actually editing, so dropping a
   * `.dsh/mainline.json` into that project is the whole installation step.
   * The legacy `scope-drift.json` name is accepted at lower priority.
   *
   * @param cwd - the session workspace root, if the execution reports one.
   */
  considerWorkspace(cwd) {
    if (typeof cwd !== 'string' || cwd.trim() === '') return
    const dir = cwd.trim().replace(/[/\\]+$/, '')
    const paths = workspaceConfigPaths(dir)
    const fresh = paths.filter(path => !this.workspaceCandidates.includes(path))
    if (fresh.length === 0) return
    this.workspaceCandidates.unshift(...fresh)
    try {
      this.reload(true)
    } catch {
      /* a broken candidate is not a config error until it is picked */
    }
  }

  /**
   * The config view for ONE workspace, independent of which candidate the
   * global watcher currently favors.
   *
   * This is what makes several projects coexist: a session rooted at project
   * B is judged against B's roadmap even while the global watcher picked A's.
   * Explicit tier (profile row / env) still wins, then this workspace's own
   * locations, then the host-wide fallbacks. Results are cached per path by
   * mtime so judging every tool call stays a stat, not a re-read.
   *
   * @param cwd - the session workspace root.
   * @returns a describe-shaped view: `{ path, exists, candidates, status,
   *   error, loadedAt, document }`.
   */
  viewFor(cwd) {
    if (typeof cwd !== 'string' || cwd.trim() === '') return this.describe()
    const dir = cwd.trim().replace(/[/\\]+$/, '')
    const paths = [...this.explicit, ...workspaceConfigPaths(dir), ...this.hostFallback]
    const picked = pickConfigPath(paths)
    // A planning doc lives next to the code, so it is resolved per workspace,
    // not per global view; a missing config with a present roadmap.md is
    // exactly the "import me" case the panel wants to surface.
    const sourceDoc = picked.exists ? null : findSourceDoc(dir)
    let mtimeMs = 0
    if (picked.exists) {
      try {
        mtimeMs = statSync(picked.path).mtimeMs
      } catch {
        mtimeMs = 0
      }
    }
    const cached = this.viewCache.get(picked.path)
    if (cached !== undefined && cached.mtimeMs === mtimeMs) {
      return { ...cached.view, candidates: paths, sourceDoc: cached.view.sourceDoc ?? null }
    }
    const result = readConfig(picked.path, picked.exists)
    const view = {
      path: result.path,
      exists: picked.exists,
      status: result.status,
      error: result.error ?? null,
      loadedAt: picked.exists ? new Date().toISOString() : null,
      document: result.config ?? null,
      sourceDoc,
    }
    if (this.viewCache.size >= 8) this.viewCache.clear()
    this.viewCache.set(picked.path, { mtimeMs, view })
    return { ...view, candidates: paths }
  }

  /** The config in force. When the file is broken this is the last good one. */
  get current() {
    return this.config
  }

  /** Load now, notify only on a real change. */
  reload(force = false) {
    const picked = pickConfigPath(this.candidates)
    this.path = picked.path
    this.exists = picked.exists
    let mtimeMs = 0
    if (picked.exists) {
      try {
        mtimeMs = statSync(picked.path).mtimeMs
      } catch {
        mtimeMs = 0
      }
    }
    if (!force && mtimeMs === this.mtimeMs && this.loadedAt !== null) return false
    const result = readConfig(picked.path, picked.exists)
    this.mtimeMs = mtimeMs
    this.loadedAt = new Date().toISOString()
    this.status = result.status
    this.error = result.error ?? null
    if (result.status === 'ok') this.config = result.config
    for (const listener of this.listeners) {
      try {
        listener(this)
      } catch {
        /* a broken listener must not take the poller down */
      }
    }
    return true
  }

  /** Begin polling the file. Idempotent. */
  watch() {
    if (this.timer !== null) return
    this.reload(true)
    this.timer = setInterval(() => {
      try {
        this.reload(false)
      } catch {
        /* transient stat failures are not config errors */
      }
    }, WATCH_INTERVAL_MS)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /** Stop polling. */
  dispose() {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.listeners.clear()
    this.viewCache.clear()
  }

  /** The JSON-safe view the panel renders. */
  describe() {
    return {
      path: this.path,
      exists: this.exists,
      candidates: this.candidates,
      status: this.status,
      loadedAt: this.loadedAt,
      error: this.error,
      // The document itself, so the panel can render scope + acceptance
      // without a second round trip.
      document: this.config,
    }
  }
}
