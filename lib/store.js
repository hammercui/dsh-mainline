/**
 * In-memory observation ledger for the dashboard.
 *
 * Everything here is derived state: a bounded ring of recent actions, a merged
 * alert queue, and the counters behind the health overview. Nothing is
 * persisted and nothing is written to disk — restarting the host starts a new
 * observation window, which is what a "what is the agent doing right now"
 * panel should mean.
 *
 * @module dsh-mainline/store
 */
const MAX_EVENTS = 200
const MAX_ALERTS = 100

/** Levels that raise an alert. `display` never does. */
const ALERT_LEVELS = new Set(['red', 'yellow'])

/**
 * Observation ledger with a coarse change feed.
 *
 * The feed emits small patches (`{ type: 'patch', ... }`) rather than a whole
 * snapshot so an SSE push stays constant-size no matter how long the session
 * has been running.
 */
export class ScopeStore {
  constructor() {
    /** @type {Array<Record<string, unknown>>} newest last */
    this.events = []
    /** @type {Map<number, Record<string, unknown>>} seq → event for O(1) patching */
    this.bySeq = new Map()
    /** @type {Array<Record<string, unknown>>} newest first */
    this.alerts = []
    this.byKey = new Map()
    this.counts = { green: 0, red: 0, yellow: 0, display: 0 }
    this.seq = 0
    this.startedAt = new Date().toISOString()
    this.lastAt = null
    this.running = new Map()
    this.listeners = new Set()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(patch) {
    for (const listener of this.listeners) {
      try {
        listener(patch)
      } catch {
        /* one broken stream must not stop the others */
      }
    }
  }

  /**
   * Record a freshly started action.
   * @param verdict - the four-level judgment from `classify.decide`.
   * @param meta - attribution stamped at event time (milestone/task/agent).
   * @returns the stored event.
   */
  record(verdict, meta = {}) {
    this.seq += 1
    const at = new Date().toISOString()
    const event = {
      seq: this.seq,
      at,
      tool: verdict.tool,
      variant: verdict.variant,
      level: verdict.level,
      reason: verdict.reason,
      summary: verdict.summary,
      targets: verdict.targets ?? [],
      milestone: meta.milestone ?? null,
      task: meta.task ?? null,
      agent: meta.agent ?? null,
      session: meta.session ?? null,
      state: 'running',
      ms: null,
      failed: null,
    }
    this.events.push(event)
    this.bySeq.set(event.seq, event)
    if (this.events.length > MAX_EVENTS) {
      const dropped = this.events.shift()
      if (dropped !== undefined) this.bySeq.delete(dropped.seq)
    }
    this.counts[event.level] = (this.counts[event.level] ?? 0) + 1
    this.lastAt = at
    if (meta.token !== undefined) this.running.set(meta.token, event.seq)

    let alert = null
    if (ALERT_LEVELS.has(event.level)) alert = this.mergeAlert(event)
    // Absent parts are omitted rather than sent as null: a null field makes a
    // consumer test each key instead of trusting what is present.
    this.emit(this.patch(alert === null ? { event } : { event, alert }))
    return event
  }

  /**
   * Merge one alert into the queue.
   *
   * Merge key is level + tool + target, so twenty writes to the same
   * out-of-scope file stay ONE row with a ×20 badge instead of flooding the
   * panel — the whole point of having a queue at all.
   *
   * @param event - the event that triggered the alert.
   */
  mergeAlert(event) {
    const target = event.targets[0]?.path ?? event.summary ?? ''
    const key = `${event.level}|${event.tool}|${target}`
    const existing = this.byKey.get(key)
    if (existing !== undefined) {
      existing.count += 1
      existing.lastAt = event.at
      existing.lastSeq = event.seq
      if (existing.reason !== event.reason) existing.reason = event.reason
      // The queue merges across sessions by design; the contributing session
      // ids ride along so a session-filtered view can still show its share.
      if (event.session !== null && !existing.sessions.includes(event.session)) {
        existing.sessions.push(event.session)
      }
      return existing
    }
    const alert = {
      id: `${event.seq}`,
      key,
      level: event.level,
      tool: event.tool,
      target,
      reason: event.reason,
      milestone: event.milestone,
      firstAt: event.at,
      lastAt: event.at,
      firstSeq: event.seq,
      lastSeq: event.seq,
      count: 1,
      sessions: event.session === null ? [] : [event.session],
    }
    this.alerts.unshift(alert)
    this.byKey.set(key, alert)
    if (this.alerts.length > MAX_ALERTS) {
      const dropped = this.alerts.pop()
      if (dropped !== undefined) this.byKey.delete(dropped.key)
    }
    return alert
  }

  /**
   * Settle a started action (`tools/result`).
   * @param token - execution token used to match the start.
   * @param outcome - `{ failed }`.
   * @returns the patched event, or undefined when it already left the ring.
   */
  settle(token, outcome) {
    const seq = this.running.get(token)
    if (seq === undefined) return undefined
    this.running.delete(token)
    const event = this.bySeq.get(seq)
    if (event === undefined) return undefined
    event.state = 'done'
    event.failed = outcome?.failed === true
    event.ms = typeof outcome?.ms === 'number' ? outcome.ms : null
    this.emit(this.patch({ update: event }))
    return event
  }

  /** Health overview: per-level totals plus the drift share that matters. */
  health() {
    const judged = this.counts.green + this.counts.red + this.counts.yellow
    const drifted = this.counts.red + this.counts.yellow
    return {
      counts: { ...this.counts },
      judged,
      drifted,
      driftRatio: judged === 0 ? 0 : Math.round((drifted / judged) * 1000) / 1000,
      total: this.counts.green + this.counts.red + this.counts.yellow + this.counts.display,
      startedAt: this.startedAt,
      lastAt: this.lastAt,
      alertCount: this.alerts.length,
    }
  }

  /** The current action: the newest event, which `tools/result` then settles. */
  current() {
    const last = this.events[this.events.length - 1]
    return last === undefined ? null : { ...last }
  }

  /** One wire patch; every consumer applies the fields that are present. */
  patch(extra = {}) {
    return { type: 'patch', seq: this.seq, health: this.health(), current: this.current(), ...extra }
  }

  /** Full state for a first paint or a resync after a missed sequence. */
  snapshot() {
    return {
      seq: this.seq,
      health: this.health(),
      current: this.current(),
      events: this.events.slice().reverse(),
      alerts: this.alerts.slice(),
    }
  }

  /**
   * The ledger sliced to one session.
   *
   * Health is recomputed from the ring for that slice, so a session-filtered
   * panel shows the project's own numbers instead of the machine-wide ones.
   * With no session (or an unknown one) this is the plain global snapshot.
   */
  viewFor(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return this.snapshot()
    const events = this.events.filter(event => event.session === sessionId)
    const alerts = this.alerts.filter(alert =>
      Array.isArray(alert.sessions) && alert.sessions.includes(sessionId))
    const last = events.length > 0 ? events[events.length - 1] : null
    const counts = { green: 0, red: 0, yellow: 0, display: 0 }
    for (const event of events) counts[event.level] = (counts[event.level] ?? 0) + 1
    const judged = counts.green + counts.red + counts.yellow
    const drifted = counts.red + counts.yellow
    return {
      seq: this.seq,
      health: {
        counts,
        judged,
        drifted,
        driftRatio: judged === 0 ? 0 : Math.round((drifted / judged) * 1000) / 1000,
        total: events.length,
        startedAt: this.startedAt,
        lastAt: last === null ? null : last.at,
        alertCount: alerts.length,
      },
      current: last === null ? null : { ...last },
      events: events.slice().reverse(),
      alerts: alerts.slice(),
    }
  }

  /**
   * Re-frame one live patch for a session-filtered subscriber.
   *
   * The store broadcasts machine-wide; this drops parts that belong to other
   * sessions and replaces the global health/current head with the session's
   * own, so a per-project panel never sees a foreign "current action".
   */
  frameFor(patch, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return patch
    const view = this.viewFor(sessionId)
    const framed = { type: patch.type, seq: view.seq, health: view.health, current: view.current }
    if (patch.event !== undefined && patch.event !== null && patch.event.session === sessionId) framed.event = patch.event
    if (patch.update !== undefined && patch.update !== null && patch.update.session === sessionId) framed.update = patch.update
    if (patch.alert !== undefined && patch.alert !== null && Array.isArray(patch.alert.sessions) && patch.alert.sessions.includes(sessionId)) {
      framed.alert = patch.alert
    }
    return framed
  }
}
