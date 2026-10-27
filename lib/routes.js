/**
 * The read-only HTTP face of the dashboard.
 *
 * Three GET routes and nothing else: no POST, no mutation, no config write.
 * That is the product boundary expressed in code, not just in a doc comment.
 *
 * Access: the panel is served by the same host that serves the GUI, so the
 * only requirement is a loopback socket and (when the browser sends one) an
 * origin that is itself local. A cross-site page on this machine therefore
 * cannot read the observation feed.
 *
 * @module dsh-mainline/routes
 */

/** Root-absolute prefix; the client drops the leading slash because the page
 *  is served with `<base href="./">`. */
export const API_PREFIX = '/dsh-mainline'

const HEARTBEAT_MS = 15_000
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Whether a request may read the dashboard.
 *
 * @param request - the incoming request.
 * @returns true for a local socket with a local-or-absent origin.
 */
export function isTrustedRequest(request) {
  const remote = request.socket?.remoteAddress ?? ''
  if (!LOOPBACK.has(remote)) return false
  const origin = request.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  if (origin === 'null') return true
  try {
    const host = new URL(origin).hostname
    return LOOPBACK.has(host) || host === 'localhost'
  } catch {
    return false
  }
}

function writeJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

/**
 * Build the route set.
 * @param store - the observation ledger.
 * @param config - the hot-reloading scope config.
 * @param info - static server facts echoed to the panel (`version`, `pid`).
 * @param sessions - optional registry `Map<sessionId, {cwd, title, …}>` the
 *   observers keep; enables the `?session=` per-project views.
 * @returns the routes to register on `ctx.webServer`.
 */
export function makeRoutes(store, config, info = {}, sessions = null) {
  const guard = (request, response) => {
    if (isTrustedRequest(request)) return true
    writeJson(response, 403, { ok: false, error: 'forbidden' })
    return false
  }

  /** The `?session=` filter of a request, or null for the machine-wide view. */
  const sessionOf = request => {
    try {
      const value = new URL(request.url, 'http://localhost').searchParams.get('session')
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
    } catch {
      return null
    }
  }

  /** Known sessions, newest activity first, trimmed for the wire. */
  const sessionsView = () => {
    if (sessions === null || typeof sessions.values !== 'function') return []
    return [...sessions.values()]
      .sort((a, b) => String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')))
      .slice(0, 20)
      .map(entry => ({
        id: entry.id,
        tail: typeof entry.id === 'string' && entry.id.length > 8 ? entry.id.slice(-8) : entry.id,
        cwd: entry.cwd ?? null,
        title: entry.title ?? null,
        // The session's `/goal`, read from the host goals service at its last
        // action — display only, the dashboard never writes goals.
        goal: entry.goal ?? null,
        lastAt: entry.lastAt ?? null,
      }))
  }

  /** The config view that matches a session's own workspace. */
  const configViewFor = session => {
    if (session === null || sessions === null) return config.describe()
    const known = sessions.get(session)
    if (known === undefined || typeof known.cwd !== 'string' || known.cwd === '') return config.describe()
    return config.viewFor(known.cwd)
  }

  const state = {
    kind: 'exact',
    path: `${API_PREFIX}/state`,
    handler: (request, response) => {
      if (request.method !== 'GET') return writeJson(response, 405, { ok: false, error: 'method-not-allowed' })
      if (!guard(request, response)) return
      const session = sessionOf(request)
      writeJson(response, 200, {
        ok: true,
        ...store.viewFor(session),
        session,
        sessions: sessionsView(),
        config: configViewFor(session),
        server: { ...info, now: new Date().toISOString() },
      })
    },
  }

  const events = {
    kind: 'exact',
    path: `${API_PREFIX}/events`,
    handler: (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405)
        response.end()
        return
      }
      if (!guard(request, response)) return
      const session = sessionOf(request)
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      const send = payload => {
        try {
          response.write(`data: ${JSON.stringify(payload)}\n\n`)
        } catch {
          /* the socket went away between the patch and this write */
        }
      }
      // First frame is a full snapshot: the panel never has to stitch up an
      // in-progress action from deltas it did not see.
      send({
        type: 'snapshot',
        ...store.viewFor(session),
        session,
        sessions: sessionsView(),
        config: configViewFor(session),
        server: { ...info, now: new Date().toISOString() },
      })
      // A filtered subscriber gets the patch re-framed to its session: foreign
      // parts are dropped and health/current are the session's own numbers.
      const unsubscribe = store.subscribe(patch => { send(store.frameFor(patch, session)) })
      const onConfig = () => { send({ type: 'config', config: configViewFor(session) }) }
      config.listeners.add(onConfig)
      const heartbeat = setInterval(() => {
        try {
          response.write(': ping\n\n')
        } catch {
          /* closed */
        }
      }, HEARTBEAT_MS)
      if (typeof heartbeat.unref === 'function') heartbeat.unref()
      const close = () => {
        clearInterval(heartbeat)
        unsubscribe()
        config.listeners.delete(onConfig)
      }
      request.once('close', close)
      response.once('close', close)
    },
  }

  const exportRoute = {
    kind: 'exact',
    path: `${API_PREFIX}/export`,
    handler: (request, response) => {
      if (request.method !== 'GET') return writeJson(response, 405, { ok: false, error: 'method-not-allowed' })
      if (!guard(request, response)) return
      const snapshot = store.snapshot()
      const document = {
        exportedAt: new Date().toISOString(),
        plugin: 'dsh-mainline',
        version: info.version ?? null,
        config: { path: config.path, status: config.status, loadedAt: config.loadedAt, error: config.error, activeMilestone: config.current?.activeMilestoneId ?? null },
        health: snapshot.health,
        alerts: snapshot.alerts,
        events: snapshot.events,
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      writeJson(response, 200, document, { 'content-disposition': `attachment; filename="mainline-${stamp}.json"` })
    },
  }

  return [state, events, exportRoute]
}
