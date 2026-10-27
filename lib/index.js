/**
 * Host half of the Agent scope-drift dashboard.
 *
 * Responsibilities, deliberately narrow:
 *   - observe `tools/pre-execute` (waterfall: we NEVER decide, we always
 *     return `next()`) and `tools/result` (settle the row);
 *   - judge each observation against the hot-reloaded scope config;
 *   - serve the read-only `GET /dsh-mainline/{state,events,export}` routes.
 *
 * Nothing is blocked, corrected, or written. A failure anywhere in this file
 * is caught and logged: an external plugin that throws during apply would take
 * the whole GUI boot down with it.
 *
 * @module dsh-mainline
 */
import { createRequire } from 'node:module'
import { ScopeConfig } from './config.js'
import { decide } from './classify.js'
import { ScopeStore } from './store.js'
import { makeRoutes } from './routes.js'
import { createCapabilitiesProjection } from './capabilities.js'
import { z } from 'zod'

const require = createRequire(import.meta.url)
/**
 * The version only labels the export payload, so a failed read must never
 * abort module evaluation: a throw here surfaces as "dsh-mainline: import
 * failed" and takes the whole web boot down with it.
 */
let VERSION = '0.0.0'
try {
  VERSION = require('../package.json')?.version ?? '0.0.0'
} catch {
  /* keep the placeholder */
}

/**
 * Services this plugin needs from the host. `webServer` owns the route table.
 *
 * Everything else — today that is `goals`, for the read-only `/goal` line — is
 * resolved opportunistically inside `apply`. Declaring it here would make the
 * whole entry wait for that service at boot; were it ever late or absent the
 * entry would not activate and web boot would report a failed entry. A missing
 * goal display must never cost the dashboard.
 */
export const inject = ['webServer']

/** Cordis plugin name, also the profile row id. */
export const name = 'mainline'

const DEBUG = process.env.DSH_SCOPE_DRIFT_DEBUG === '1'

function debug(...args) {
  if (DEBUG) console.log('[mainline]', ...args)
}

/** A short, JSON-safe label for the agent that issued a call. */
function agentLabel(agent) {
  if (agent === undefined || agent === null || typeof agent !== 'object') return null
  const header = agent.session?.header
  const id = typeof header?.id === 'string' ? header.id : typeof agent.id === 'string' ? agent.id : null
  if (id === null) return null
  // Session ids are long and share a prefix; the tail is what distinguishes them.
  return id.length > 12 ? id.slice(-8) : id
}

/** The full session id an execution belongs to, if the header carries one. */
function sessionIdOf(agent) {
  const header = agent?.session?.header
  if (typeof header?.id === 'string' && header.id.trim() !== '') return header.id.trim()
  if (typeof agent?.id === 'string' && agent.id.trim() !== '') return agent.id.trim()
  return null
}

/** The session title, when the header carries one. */
function sessionTitleOf(agent) {
  const title = agent?.session?.header?.title
  return typeof title === 'string' && title.trim() !== '' ? title.trim() : null
}

/** The session workspace root an execution reports, if any. */
function workspaceOf(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : null
}

/** Log through the host logger when there is one, without ever throwing. */
function warn(ctx, message, error) {
  const logger = ctx?.logger
  const text = `[mainline] ${message}`
  try {
    if (typeof logger?.warn === 'function') logger.warn(text, error)
    else console.warn(text, error)
  } catch {
    /* a logger that throws is not worth a second failure */
  }
}

/**
 * The `/goal` of a session, reduced to what the panel shows.
 *
 * Read from the host goals service (`goals.get(agent)`, backed by the
 * session log) and NEVER written to. A goal is session-scoped intent while
 * the roadmap is project-scoped plan: the panel only *displays* the goal —
 * it never flips a task's `status`, which stays config-driven.
 *
 * Fields are read defensively: GoalView's wire shape is not part of any
 * public contract, so objective/text/title are tried in order.
 */
function goalSummary(view) {
  if (view === null || view === undefined || typeof view !== 'object') return null
  const found = [view.objective, view.text, view.title].find(value => typeof value === 'string' && value.trim() !== '')
  const status = typeof view.status === 'string' && view.status.trim() !== '' ? view.status.trim() : null
  if (found === undefined && status === null) return null
  return { objective: found === undefined ? null : found.trim(), status }
}

/**
 * Mount the dashboard.
 * @param ctx - host plugin context (`webServer` injected; `goals` optional).
 * @param config - the profile row's config: `{ configFile? }`.
 */
export function apply(ctx, config) {
  // Native per-session projection: replayable, scoped, and disposed on unload.
  ctx.inject(['sessionProjections'], projectionCtx => {
    projectionCtx.sessionProjections.register(createCapabilitiesProjection(z))
  })
  const store = new ScopeStore()
  const scopeConfig = new ScopeConfig({ configFile: config?.configFile })
  /** token → wall clock, so `tools/result` can report a duration. */
  const startedAt = new Map()
  /**
   * Resolve the goals service WITHOUT declaring it in `inject`.
   *
   * Declaring it would make the entry wait for it at boot, and a late service
   * would leave the whole plugin inactive (web boot then reports a failed
   * entry). Resolving lazily keeps the goal line optional: it appears when the
   * service is composed and silently disappears when it is not.
   */
  const resolveGoals = () => {
    try {
      if (typeof ctx.get === 'function') {
        const candidate = ctx.get('goals')
        if (candidate !== undefined && candidate !== null && typeof candidate.get === 'function') return candidate
      }
    } catch {
      /* service lookup is best-effort */
    }
    const direct = ctx.goals
    return direct !== undefined && direct !== null && typeof direct.get === 'function' ? direct : null
  }
  const readGoal = agent => {
    const goals = resolveGoals()
    if (goals === null) return null
    try {
      return goalSummary(goals.get(agent))
    } catch {
      return null
    }
  }
  /**
   * sessionId → { id, cwd, title, goal, firstAt, lastAt }.
   *
   * The registry behind `?session=`: which session lives in which project,
   * so the right pane can follow the session the user is looking at and be
   * judged against THAT project's roadmap. `goal` is the session's `/goal`
   * at the moment of its latest action — display only.
   */
  const sessions = new Map()
  const MAX_SESSIONS = 50

  const rememberSession = exec => {
    const id = sessionIdOf(exec?.agent)
    if (id === null) return null
    const now = new Date().toISOString()
    const workspace = workspaceOf(exec?.agent)
    const entry = sessions.get(id) ?? { id, cwd: null, title: null, goal: null, firstAt: now, lastAt: now }
    if (workspace !== null) entry.cwd = workspace
    const title = sessionTitleOf(exec?.agent)
    if (title !== null) entry.title = title
    const goal = readGoal(exec?.agent)
    if (goal !== null) entry.goal = goal
    entry.lastAt = now
    sessions.set(id, entry)
    if (sessions.size > MAX_SESSIONS) {
      let oldestId = null
      let oldestAt = ''
      for (const candidate of sessions.values()) {
        const at = String(candidate.lastAt ?? '')
        if (candidate.id !== id && at < oldestAt) {
          oldestAt = at
          oldestId = candidate.id
        }
      }
      if (oldestId !== null) sessions.delete(oldestId)
    }
    return entry
  }

  const observe = exec => {
    try {
      // The session workspace is the project the user actually cares about, so
      // it is offered as a config location before anything host-wide.
      const workspace = workspaceOf(exec?.agent)
      if (workspace !== null) scopeConfig.considerWorkspace(workspace)
      rememberSession(exec)
      // Judge against THIS session's project roadmap, not whichever candidate
      // the global watcher happens to favor — two projects must not judge
      // each other's writes.
      const view = workspace !== null ? scopeConfig.viewFor(workspace) : null
      const current = view?.document ?? scopeConfig.current
      const verdict = decide(exec, { config: current, root: current?.root ?? null })
      const token = exec?.token
      if (token !== undefined) startedAt.set(token, Date.now())
      const event = store.record(verdict, {
        token,
        session: sessionIdOf(exec?.agent),
        milestone: current?.activeMilestoneId ?? null,
        task: current?.activeTaskId ?? null,
        agent: agentLabel(exec?.agent),
      })
      debug(event.level, event.tool, event.summary)
    } catch (error) {
      // An observation that cannot be built is dropped, never fatal.
      warn(ctx, 'observe failed', error)
    }
  }

  const settle = (exec, result) => {
    try {
      const token = exec?.token
      if (token === undefined) return
      const begin = startedAt.get(token)
      startedAt.delete(token)
      store.settle(token, {
        failed: result?.isError === true,
        ms: begin === undefined ? null : Date.now() - begin,
      })
    } catch (error) {
      warn(ctx, 'settle failed', error)
    }
  }

  ctx.effect(() => {
    const disposers = []
    try {
      scopeConfig.watch()
      disposers.push(() => { scopeConfig.dispose() })

      // Waterfall: we own no decision, so we MUST hand it on. Awaiting here
      // keeps ordering; the body itself is synchronous bookkeeping.
      const offPre = ctx.on('tools/pre-execute', async (exec, next) => {
        observe(exec)
        return next()
      })
      if (typeof offPre === 'function') disposers.push(offPre)
      else if (typeof offPre?.dispose === 'function') disposers.push(() => { offPre.dispose() })

      const offResult = ctx.on('tools/result', (exec, result) => { settle(exec, result) })
      if (typeof offResult === 'function') disposers.push(offResult)
      else if (typeof offResult?.dispose === 'function') disposers.push(() => { offResult.dispose() })

      for (const route of makeRoutes(store, scopeConfig, { version: VERSION, pid: process.pid }, sessions)) {
        disposers.push(ctx.webServer.register(route))
      }
    } catch (error) {
      // A half-mounted dashboard is worse than none: release what we took.
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          /* already gone */
        }
      }
      warn(ctx, 'mount failed', error)
    }
    return () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          /* already gone */
        }
      }
      startedAt.clear()
      sessions.clear()
    }
  }, 'mainline: observation + routes')
}
