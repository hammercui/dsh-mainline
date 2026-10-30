/**
 * Browser half of the Agent scope-drift dashboard.
 *
 * One sidebar row (`sidebar.panellist`) plus one center-column page (`main`),
 * both registered through the shell's own slot seats so the row inherits the
 * shell's geometry, highlight and rail behaviour instead of fighting it.
 *
 * Everything rendered here comes from the host's read-only
 * `GET /dsh-mainline/{state,events}`. The panel never sends a mutation: the
 * only two user actions are "copy" and "download" of the data already on
 * screen.
 *
 * @module dsh-mainline/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-mainline',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    const exports = module.exports

    /** Panel id shared by the sidebar row, the main page and `layout.selectPanel`. */
    const PANEL_ID = 'mainline'

    /** Native right-sidebar tab: definition id (also the body slot key). */
    const TAB_ID = 'dsh-mainline/native'

    /** Native right-sidebar tab: the kind `openTab(kind)` addresses. */
    const TAB_KIND = 'dsh-mainline:dashboard'

    /** Row order among the shell's global panel rows (Plugins 0, Schedule 10). */
    const PANEL_ORDER = 30

    /**
     * Document-relative API bases. The page is served with `<base href="./">`,
     * so a leading slash would escape the entry directory in a sub-path
     * deployment — the same reason the task board strips it.
     *
     * The pre-rename host keeps serving `/dsh-scope-drift` until the app
     * restarts clears its module cache, so the base is PROBED once and the
     * winner reused: whichever prefix actually answers is the one mounted.
     */
    const API = 'dsh-mainline'
    const LEGACY_API = 'dsh-scope-drift'
    let apiBasePromise = null

    function resolveApiBase() {
      if (apiBasePromise === null) {
        apiBasePromise = (async () => {
          for (const base of [API, LEGACY_API]) {
            try {
              const response = await fetch(`${base}/state`, { headers: { accept: 'application/json' }, cache: 'no-store' })
              // Anything but 404 means the route family is mounted (403 = it
              // exists but refused us, which still tells us the prefix).
              if (response.status !== 404) return base
            } catch {
              /* try the next candidate */
            }
          }
          return API
        })()
      }
      return apiBasePromise
    }

    const LEVELS = {
      green: { label: '允许', emoji: '🟢', color: '#22c55e' },
      red: { label: '禁止', emoji: '🔴', color: '#ef4444' },
      yellow: { label: '计划外', emoji: '🟡', color: '#f59e0b' },
      display: { label: '仅展示', emoji: '⚪', color: '#94a3b8' },
    }

    const TEMPLATE = `{
  "version": 1,
  "project": "your-project",
  "root": "D:/your/project",
  "activeMilestone": "M1",
  "activeTask": "M1-2",
  "forbid": ["**/.env", "**/secrets/**"],
  "milestones": [
    {
      "id": "M1",
      "title": "里程碑标题",
      "allow": ["$WS/**"],
      "forbid": ["$WS/prod/**"],
      "tasks": [
        { "id": "M1-1", "title": "已完成", "status": "done" },
        { "id": "M1-2", "title": "正在做（当前位置）" },
        { "id": "M1-3", "title": "还没开始", "status": "todo" }
      ]
    }
  ]
}`

    const STYLE_ID = 'dsh-mainline-style'
    const CSS_TEXT = `
.sd-root { --sd-line: color-mix(in srgb, currentColor 16%, transparent); --sd-surface: color-mix(in srgb, currentColor 4%, transparent);
  display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; font-size: 13px; color: inherit; }.sd-head { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-bottom: 1px solid var(--sd-line); flex-wrap: wrap; }
.sd-title { font-weight: 600; letter-spacing: .2px; }
.sd-spacer { flex: 1 1 auto; }
.sd-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--sd-line); font-size: 11px; opacity: .95; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.sd-chip[data-tone="red"] { border-color: rgba(239,68,68,.55); color: #ef4444; }
.sd-chip[data-tone="yellow"] { border-color: rgba(245,158,11,.55); color: #d97706; }
.sd-chip[data-tone="green"] { border-color: rgba(34,197,94,.55); color: #16a34a; }
.sd-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .35; }
.sd-dot[data-live="true"] { background: #22c55e; opacity: 1; }
.sd-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 18px; display: flex; flex-direction: column; gap: 12px; }
.sd-card { border: 1px solid var(--sd-line); border-radius: 10px; background: var(--sd-surface); padding: 10px 12px; }
.sd-banner { border: 1px solid rgba(239,68,68,.5); border-radius: 10px; padding: 9px 12px; background: rgba(239,68,68,.08); }
.sd-banner h4 { margin: 0 0 4px; font-size: 12.5px; color: #ef4444; }
.sd-banner pre { margin: 6px 0 0; font-size: 11px; white-space: pre-wrap; word-break: break-word; opacity: .85; }
.sd-current { display: flex; gap: 14px; align-items: flex-start; }
.sd-level { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; white-space: nowrap; }
.sd-tool { font-size: 13px; font-weight: 600; }
.sd-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.sd-target { font-size: 12px; word-break: break-all; opacity: .92; }
.sd-sub { font-size: 11.5px; opacity: .82; }
.sd-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.sd-stat { border: 1px solid var(--sd-line); border-radius: 8px; padding: 6px 9px; }
.sd-stat b { display: block; font-size: 18px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.sd-stat span { font-size: 11px; opacity: .85; }
.sd-bar { height: 6px; border-radius: 999px; overflow: hidden; display: flex; background: var(--sd-line); }
.sd-bar i { display: block; height: 100%; }
.sd-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--sd-line); }
.sd-tab { padding: 5px 10px; border-radius: 8px 8px 0 0; font-size: 12px; cursor: pointer; opacity: .82;
  border: 1px solid transparent; border-bottom: none; background: none; color: inherit; font-family: inherit; }
.sd-tab[data-active="true"] { opacity: 1; border-color: var(--sd-line); background: var(--sd-surface); }
.sd-row { display: flex; gap: 8px; align-items: baseline; padding: 5px 0; border-bottom: 1px dashed var(--sd-line); }
.sd-row:last-child { border-bottom: none; }
.sd-row .sd-when { font-size: 11px; opacity: .8; min-width: 52px; font-variant-numeric: tabular-nums; }
.sd-row .sd-what { flex: 1; min-width: 0; }
.sd-count { font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--sd-line); }
.sd-empty { padding: 26px 8px; text-align: center; opacity: .85; font-size: 12.5px; }
.sd-btn { font: inherit; font-size: 11.5px; padding: 3px 9px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--sd-line); background: var(--sd-surface); color: inherit; }
.sd-btn:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.sd-btn[disabled] { opacity: .45; cursor: default; }
.sd-foot { display: flex; gap: 6px; align-items: center; padding-top: 2px; flex-wrap: wrap; }
.sd-kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; font-size: 12px; }
.sd-kv dt { opacity: .85; }
.sd-kv dd { margin: 0; word-break: break-all; }
.sd-list { margin: 4px 0 0; padding-left: 16px; font-size: 11.5px; opacity: .92; }
.sd-list li { margin: 1px 0; word-break: break-all; }
.sd-untested { font-size: 10.5px; padding: 0 5px; border-radius: 4px; border: 1px solid var(--sd-line); opacity: .85; margin-left: 6px; white-space: nowrap; }
.sd-h4 { margin: 0 0 6px; font-size: 12px; opacity: .95; font-weight: 600; }
.sd-pre { margin: 6px 0 0; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--sd-line);
  font-size: 11px; white-space: pre; overflow: auto; max-height: 240px; }
/* Narrow right-sidebar variant: same data, stacked tighter. */
.sd-side { padding: 8px; gap: 8px; font-size: 12px; }
.sd-side .sd-card { padding: 8px 9px; border-radius: 8px; }
.sd-side .sd-head { padding: 0 2px; border-bottom: none; }
.sd-side .sd-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.sd-side .sd-stat { padding: 4px 7px; }
.sd-side .sd-stat b { font-size: 15px; }
.sd-side .sd-tab { padding: 4px 8px; font-size: 11.5px; }
.sd-side .sd-body { padding: 0; overflow: hidden; }
.sd-side .sd-scroll { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.sd-side .sd-dock { margin-left: -8px; margin-right: -8px; margin-bottom: -8px; }
.sd-side .sd-dock-bar { padding: 3px 10px; }
.sd-side .sd-foot { padding: 0 2px; }
/* Roadmap git-graph: HTML rows carry text, an SVG overlay draws the lines.
   The overlay is a sibling of the rows inside the same positioning context,
   so both share one origin and every node lands on its row. */
.sd-map { position: relative; padding: 10px 10px 12px 6px; overflow-x: auto; overflow-y: hidden; }
.sd-map-lines { position: absolute; top: 0; left: 0; pointer-events: none; }
/* View switcher: the same roadmap in two shapes (compact trunk / stage flow). */
.sd-map-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px 6px; }
.sd-seg { display: inline-flex; align-items: stretch; border: 1px solid var(--sd-line); border-radius: 8px; overflow: hidden; }
.sd-seg button { font: inherit; font-size: 11.5px; padding: 5px 10px; display: inline-flex; align-items: center; gap: 5px;
  color: inherit; background: transparent; border: 0; cursor: pointer; opacity: .85; white-space: nowrap; }
.sd-seg button + button { border-left: 1px solid var(--sd-line); }
.sd-seg button[aria-pressed="true"] { font-weight: 700; opacity: 1; background: color-mix(in srgb, currentColor 12%, transparent); }
.sd-seg button:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
.sd-zoom { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; }
.sd-map button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.sd-side-tabs { display: flex; gap: 4px; padding: 8px 10px 0; border-bottom: 1px solid var(--sd-line); }
.sd-side-tab { appearance: none; border: 0; border-bottom: 2px solid transparent; background: transparent; color: inherit; opacity: .78; padding: 6px 8px; font: inherit; font-size: 11px; cursor: pointer; }
.sd-side-tab-active { opacity: 1; border-bottom-color: currentColor; font-weight: 700; }
.sd-cap-page { --cap-accent: var(--dsw-alias-brand-primary, currentColor); --cap-muted: var(--dsw-alias-label-secondary, currentColor); --cap-bg: var(--dsw-alias-bg-layer-1, var(--sd-surface)); padding: 16px 12px 20px; min-width: 0; line-height: 1.55; color: var(--dsw-alias-label-primary, inherit); }
.sd-cap-header h2 { margin: 0; font-size: 15px; font-weight: 650; }
.sd-cap-header p, .sd-cap-caption { margin: 4px 0 0; font-size: 12px; opacity: .8; }
.sd-cap-filters { display: flex; gap: 6px; margin: 14px 0 20px; flex-wrap: wrap; }
.sd-cap-filters button { font: inherit; font-size: 12px; color: inherit; background: transparent; border: 1px solid var(--sd-line); border-radius: 6px; padding: 5px 10px; min-height: 32px; cursor: pointer; }
.sd-cap-filters button[aria-pressed="true"] { color: var(--cap-accent); background: color-mix(in srgb, var(--cap-accent) 12%, transparent); border-color: color-mix(in srgb, var(--cap-accent) 45%, transparent); font-weight: 600; }
.sd-cap-page :is(button, summary):focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.sd-cap-section + .sd-cap-section { margin-top: 24px; }
.sd-cap-section-head { display: flex; align-items: baseline; gap: 8px; }
.sd-cap-section-head h3 { font-size: 13px; font-weight: 650; margin: 0; }
.sd-cap-section-head > span { font-size: 11px; color: var(--cap-muted); padding: 0 6px; border-radius: 4px; background: var(--cap-bg); }
.sd-cap-list { display: flex; flex-direction: column; gap: 8px; margin: 10px 0 0; padding: 0; list-style: none; }
.sd-cap-item { padding: 12px; border: 1px solid var(--dsw-alias-border-l1, var(--sd-line)); border-radius: 9px; background: var(--cap-bg); min-width: 0; }
.sd-cap-item[data-tone="attention"] { border-left: 3px solid var(--dsw-alias-state-warn-primary, currentColor); }
.sd-cap-item[data-tone="busy"] { border-left: 3px solid var(--cap-accent); }
.sd-cap-item-head { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.sd-cap-name { font-size: 13px; font-weight: 650; overflow-wrap: anywhere; line-height: 1.5; letter-spacing: .1px; }
.sd-cap-item[data-tone="active"] { background: linear-gradient(115deg, color-mix(in srgb, var(--dsw-alias-state-success-primary, currentColor) 6%, transparent), transparent 65%), var(--cap-bg); }
.sd-cap-metrics { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 10px 0 3px; color: var(--cap-muted); font-size: 11px; }
.sd-cap-token { display: inline-flex; align-items: baseline; gap: 4px; font-variant-numeric: tabular-nums; }
.sd-cap-token strong { color: var(--dsw-alias-label-primary, inherit); font-size: 13px; font-weight: 600; }
.sd-cap-token-label { font-size: 10px; }
.sd-cap-overview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 14px 0; }
.sd-cap-overview > div { padding: 10px; background: var(--cap-bg); border: 1px solid var(--sd-line); border-radius: 8px; }
.sd-cap-overview strong { display: block; font-size: 19px; line-height: 1.3; font-weight: 650; font-variant-numeric: tabular-nums; }
.sd-cap-overview span { display: block; margin-top: 3px; color: var(--cap-muted); font-size: 11px; }
.sd-cap-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; line-height: 1.5; white-space: nowrap; padding: 2px 0; color: var(--dsw-alias-state-success-primary, currentColor); background: transparent; }
.sd-cap-status[data-tone="attention"] { color: var(--dsw-alias-state-warn-primary, currentColor); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, currentColor) 12%, transparent); font-weight: 600; }
.sd-cap-status[data-tone="busy"] { color: var(--cap-accent); background: color-mix(in srgb, var(--cap-accent) 12%, transparent); font-weight: 600; }
.sd-cap-status[data-tone="idle"] { color: var(--cap-muted); background: var(--sd-surface); }
.sd-cap-item[data-tone="active"] { border-left: 3px solid var(--dsw-alias-state-success-primary, currentColor); }
.sd-cap-signal { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 6px; }
.sd-cap-signal[data-pulse="true"] { animation: sd-cap-breathe 2s ease-in-out infinite; }
@keyframes sd-cap-breathe { 0%, 100% { opacity: .5; box-shadow: 0 0 0 0 transparent; } 50% { opacity: 1; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent); } }
@media (prefers-reduced-motion: reduce) { .sd-cap-signal[data-pulse="true"] { animation: none; opacity: 1; } }
.sd-cap-description { margin: 5px 0 7px; font-size: 12px; line-height: 1.65; opacity: .88; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sd-cap-notice { margin: 8px 0; padding: 6px 9px; border-left: 2px solid currentColor; background: var(--sd-surface); font-size: 12px; }
.sd-cap-details summary { cursor: pointer; font-size: 11px; min-height: 28px; line-height: 28px; opacity: .8; }
.sd-cap-details summary time { margin-left: 10px; font-variant-numeric: tabular-nums; }
.sd-cap-more { margin-left: 10px; text-decoration: underline; text-underline-offset: 3px; }
.sd-cap-detail-body { padding: 4px 0; font-size: 12px; overflow-wrap: anywhere; }
.sd-cap-detail-body p { margin: 6px 0; }
.sd-cap-empty { font-size: 12px; line-height: 1.7; opacity: .85; padding: 12px 0; }
.sd-cap-help { margin-top: 24px; font-size: 12px; border-top: 1px solid var(--sd-line); padding-top: 10px; }
.sd-cap-help summary { cursor: pointer; padding: 4px 0; }
.sd-cap-help p { margin: 8px 0; opacity: .85; }
/* Workflow form: a pannable, zoomable canvas — a layered tree of
   project → milestone → task cards over dotted paper, the same reading the
   right sidebar's task page gives its workflow graph. Cards are a fixed
   190px so the layout can budget columns; the canvas never renders below a
   0.78 readability floor, it wraps siblings instead. In the panel the canvas
   STRETCHES to fill the card's remaining height (flex: 1) so the graph owns
   the whole viewport; the fixed clamp only applies when nothing constrains it
   (the static preview). */
.sd-graph { position: relative; height: clamp(320px, 46vh, 460px); border: 1px solid var(--sd-line); border-radius: 10px; overflow: hidden;
  background-image: radial-gradient(circle, var(--sd-line) 0.7px, transparent 0.7px); background-size: 16px 16px;
  cursor: grab; touch-action: none; user-select: none; }
.sd-map[data-fill="true"] { display: flex; flex-direction: column; flex: 1 0 380px; min-height: 380px; box-sizing: border-box; }
/* The map is a flex child of sd-body (main) or sd-scroll (native sidebar).
   It must grow too; growing only sd-graph leaves the whole card content-sized. */
.sd-map[data-fill="true"] .sd-map-toolbar { flex: 0 0 auto; }
.sd-map[data-fill="true"] .sd-map-legend { flex: 0 0 auto; margin-bottom: 6px; }
.sd-map[data-fill="true"] .sd-graph { flex: 1 1 auto; height: auto; min-height: 320px; }
.sd-graph[data-dragging="true"] { cursor: grabbing; }
.sd-graph-inner { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.sd-graph-edges { position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible; }
.sd-edge { fill: none; stroke: color-mix(in srgb, currentColor 45%, transparent); stroke-width: 1.5; }
.sd-edge-live { stroke: rgba(59,130,246,.9); stroke-dasharray: 4 4; }
.sd-gframe { position: absolute; border: 1px dashed var(--sd-line); border-radius: 12px; pointer-events: none; }
.sd-gframe-label { position: absolute; left: 12px; top: 4px; font-size: 10px; opacity: .85; letter-spacing: .2px; }
.sd-gnode { position: absolute; display: flex; flex-direction: column; box-sizing: border-box; padding: 6px 9px 5px;
  border: 1px solid var(--sd-line); border-radius: 8px; background: var(--sd-surface); color: inherit;
  font: inherit; text-align: left; cursor: pointer; overflow: hidden; }
.sd-gnode::before { content: ''; position: absolute; left: 0; top: 5px; bottom: 5px; width: 3px; border-radius: 2px; background: var(--sd-accent, var(--sd-line)); }
.sd-gnode:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.sd-gnode[data-selected="true"] { box-shadow: inset 0 0 0 1.5px rgba(59,130,246,.7); }
.sd-gnode[data-current="true"] { box-shadow: inset 0 0 0 1.5px rgba(59,130,246,.45); }
.sd-gbadges { display: flex; align-items: center; gap: 5px; height: 16px; margin-bottom: 2px; font-size: 10.5px; }
.sd-gname { font-size: 12px; line-height: 18px; font-weight: 700; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sd-gnode-task .sd-gname { font-weight: 600; }
.sd-gbar { display: flex; align-items: center; gap: 5px; height: 22px; margin-top: auto; border-top: 1px solid var(--sd-line); font-size: 10.5px; }
.sd-gbar-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .9; }
.sd-gdot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.sd-gcontrols { position: absolute; right: 8px; bottom: 8px; z-index: 4; display: flex; align-items: center; gap: 1px;
  padding: 2px; border: 1px solid var(--sd-line); border-radius: 8px;
  background: color-mix(in srgb, currentColor 6%, transparent); backdrop-filter: blur(6px); box-shadow: 0 2px 10px rgba(0,0,0,.18); }
.sd-gzoom { min-width: 34px; text-align: center; font-size: 10.5px; font-variant-numeric: tabular-nums; opacity: .9; }
.sd-gword { font-size: 10px; opacity: .85; letter-spacing: .2px; }
.sd-gbadges .sd-chip { padding: 0 5px; font-size: 10px; line-height: 15px; }
.sd-gbadges .sd-mid { font-size: 10px; line-height: 15px; }
.sd-now { color: #3b82f6; border-color: rgba(59,130,246,.5); }

.sd-map-row { display: flex; align-items: center; gap: 6px; min-width: 0; box-sizing: border-box; }
/* Milestone rows read as section headers: divider above, bigger bold title,
   and the id as a colored anchor pill in the milestone's own state color. */
.sd-map-row-group { border-top: 1px solid var(--sd-line); }
.sd-map-title-main { font-size: 13px; font-weight: 700; letter-spacing: .1px; }
.sd-mid { font-size: 10.5px; padding: 0 6px; border-radius: 999px; border: 1px solid var(--sd-line); flex: 0 0 auto; }
.sd-map-row-clickable { cursor: pointer; }
.sd-map-row-clickable:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
.sd-map-row-selected { box-shadow: inset 0 0 0 1.5px rgba(59, 130, 246, 0.6); border-radius: 8px; }
.sd-caret { font: inherit; font-size: 10px; width: 16px; height: 16px; line-height: 13px; text-align: center;
  border-radius: 4px; border: 1px solid var(--sd-line); background: var(--sd-surface); color: inherit;
  cursor: pointer; padding: 0; flex: 0 0 auto; }
.sd-caret:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.sd-star { color: #f5c518; font-size: 11px; flex: 0 0 auto; }
.sd-detail { margin-top: 8px; border-top: 1px dashed var(--sd-line); padding-top: 8px; }
.sd-detail-head { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.sd-detail-close { margin-left: auto; }
.sd-slimbar { display: flex; gap: 8px; align-items: center; padding: 2px 4px; flex-wrap: wrap; }
/* Docked bottom drawer: collapsed = one slim strip pinned to the bottom edge;
   expanded = the detail tabs slide up over the map (absolute, not in flow), so
   the roadmap keeps its full height either way. */
.sd-dock { position: relative; flex: 0 0 auto; margin-top: auto; border-top: 1px solid var(--sd-line); background: var(--sd-surface); z-index: 3; }
.sd-dock-bar { display: flex; gap: 6px; align-items: center; padding: 3px 8px; flex-wrap: wrap; font-size: 11px; }
.sd-dock-bar .sd-sub { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sd-dock-body { position: absolute; left: 0; right: 0; bottom: 100%; max-height: 300px; overflow: auto; display: flex; flex-direction: column; gap: 8px;
  padding: 10px 8px 8px; border-top: 1px solid var(--sd-line); background: var(--sd-surface); box-shadow: 0 -6px 18px rgba(0,0,0,.12); }
.sd-dock-body .sd-tabs { flex-wrap: wrap; }
.sd-dock-body .sd-card { max-height: 220px; overflow: auto; }
.sd-dock .sd-btn { flex: 0 0 auto; }
.sd-map-row-current { background: rgba(59, 130, 246, 0.10); border-radius: 8px; }
.sd-map-row-live { background: rgba(59, 130, 246, 0.06); border-radius: 8px; box-shadow: inset 2px 0 0 rgba(59, 130, 246, 0.55); }
.sd-map-label { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; white-space: nowrap; overflow: hidden; flex: 1 1 auto; }
.sd-map-label b { font-size: 12.5px; }
.sd-map-bar { display: inline-block; width: 42px; height: 4px; border-radius: 999px; background: var(--sd-line); overflow: hidden; flex: 0 0 auto; }
.sd-map-bar i { display: block; height: 100%; }
.sd-map-legend { display: flex; gap: 14px; align-items: center; font-size: 10.5px; opacity: 0.85; margin: 0 0 8px 6px; flex-wrap: wrap; }
.sd-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.sd-legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
.sd-legend-bar { width: 12px; height: 2.5px; border-radius: 2px; display: inline-block; flex: 0 0 auto; }
.sd-legend-ring { width: 8px; height: 8px; border-radius: 50%; border: 2px solid; display: inline-block; flex: 0 0 auto; }
@keyframes sd-halo-pulse {
  0% { r: 7; opacity: 0.75; }
  70% { r: 13; opacity: 0; }
  100% { r: 13; opacity: 0; }
}
.sd-halo { animation: sd-halo-pulse 1.8s ease-out infinite; }
/* State word: the fixed-width leading status of every node row, so the eye
   can scan one column of verbs instead of parsing id+bar+ratio per row. */
.sd-state { flex: 0 0 42px; font-size: 11px; font-weight: 600; }
/* Session/project switcher: the row of chips that re-points the whole panel
   at another session's project (main panel), or just names the followed one. */
.sd-sessrow { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 2px 4px; }
.sd-sessrow .sd-chip { cursor: pointer; border: 1px solid transparent; }
.sd-sessrow .sd-chip[data-active='true'] { border-color: rgba(59, 130, 246, 0.65); color: #3b82f6; }
.sd-sessrow .sd-sesslabel { font-size: 10.5px; opacity: 0.85; flex: 0 0 auto; }
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      const existing = document.getElementById(STYLE_ID)
      if (existing !== null) {
        if (existing.textContent !== CSS_TEXT) existing.textContent = CSS_TEXT
        return
      }
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = CSS_TEXT
      document.head.appendChild(element)
    }

    const h = React.createElement

    function cx(...parts) {
      return parts.filter(Boolean).join(' ')
    }

    /**
     * Refresh the panel's DATA, never the page.
     *
     * This used to call `location.reload()`. A reload re-runs the shell's
     * whole web-boot sequence — plugin imports included — and the shell treats
     * one failed import as FATAL ("web boot: N entries did not activate" →
     * recovery dialog). Three desktop "crashes" were exactly that: a refresh
     * racing the module loader. The data never needed a reload: /state + the
     * SSE stream carry everything, and bumping the resync token re-runs the
     * fetch and reopens the stream. Loading NEW plugin code still needs the
     * app restart; the button's title says so.
     */
    function makeResyncRefresher(setResync) {
      return function refreshData() {
        try {
          setResync(current => current + 1)
        } catch {
          /* a dead panel simply does nothing */
        }
      }
    }

    /** `HH:MM:SS` in the user's own clock, with the date only when it differs. */
    function clock(iso) {
      if (typeof iso !== 'string' || iso === '') return '--:--:--'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '--:--:--'
      const hh = String(date.getHours()).padStart(2, '0')
      const mm = String(date.getMinutes()).padStart(2, '0')
      const ss = String(date.getSeconds()).padStart(2, '0')
      return `${hh}:${mm}:${ss}`
    }

    /** Coarse age, tuned for an "is this happening now" panel. */
    function age(iso, now) {
      if (typeof iso !== 'string' || iso === '') return ''
      const started = new Date(iso).getTime()
      if (Number.isNaN(started)) return ''
      const seconds = Math.max(0, Math.round((now - started) / 1000))
      if (seconds < 60) return `${seconds} 秒前`
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return `${minutes} 分钟前`
      return `${Math.round(minutes / 60)} 小时前`
    }

    function duration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
      if (ms < 1000) return `${Math.round(ms)}ms`
      if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
      return `${Math.round(ms / 60_000)}m`
    }

    /** Normalize a host frame into the one view model the panel renders. */
    function normalize(frame) {
      return {
        seq: frame.seq ?? 0,
        health: frame.health ?? null,
        current: frame.current ?? null,
        events: Array.isArray(frame.events) ? frame.events : [],
        alerts: Array.isArray(frame.alerts) ? frame.alerts : [],
        config: frame.config ?? null,
        server: frame.server ?? null,
        // The session this view is filtered to (null = machine-wide) plus the
        // known sessions, so a global panel can re-point itself at a project.
        session: typeof frame.session === 'string' && frame.session !== '' ? frame.session : null,
        sessions: Array.isArray(frame.sessions) ? frame.sessions : [],
      }
    }

    /**
     * Apply one stream frame. The host sends a full snapshot on connect and
     * small patches afterwards, so the panel's memory stays O(ring size).
     *
     * Every field is tested for truthiness, not `!== undefined`: the host
     * serializes absent fields as `null` on the wire, and a reducer that
     * touched `null` would throw inside React's render pass and silently
     * freeze the panel on its last snapshot.
     */
    function reduceView(view, frame) {
      if (frame === null || typeof frame !== 'object') return view
      if (frame.type === 'snapshot') return normalize(frame)
      if (frame.type === 'config') return { ...view, config: frame.config ?? view.config }
      if (frame.type !== 'patch') return view
      let events = view.events
      if (frame.event) events = [frame.event, ...events.filter(entry => entry.seq !== frame.event.seq)].slice(0, 200)
      if (frame.update) events = events.map(entry => (entry.seq === frame.update.seq ? frame.update : entry))
      let alerts = view.alerts
      if (frame.alert) {
        const incoming = frame.alert
        const index = alerts.findIndex(entry => entry.key === incoming.key)
        alerts = index === -1
          ? [incoming, ...alerts].slice(0, 100)
          : alerts.map((entry, at) => (at === index ? incoming : entry))
      }
      return {
        ...view,
        seq: frame.seq ?? view.seq,
        health: frame.health ?? view.health,
        current: frame.current ?? view.current,
        events,
        alerts,
      }
    }

    /**
     * The live view: one fetch for the first paint, then the SSE stream.
     * EventSource reconnects by itself; the badge only mirrors that.
     *
     * `sessionId` re-points the whole feed at one session's project: the host
     * filters events/alerts and answers with THAT project's roadmap. Changing
     * it (the right pane gets a new one when the user switches sessions)
     * refetches and re-streams — an old host simply ignores the parameter, so
     * the panel degrades to the machine-wide view instead of breaking.
     */
    function useObserved(resyncToken, sessionId) {
      const [state, setState] = React.useState({ status: 'connecting', error: null, view: null })
      React.useEffect(() => {
        let disposed = false
        let source = null
        let retry = null

        let base = API
        const suffix = typeof sessionId === 'string' && sessionId !== ''
          ? `?session=${encodeURIComponent(sessionId)}`
          : ''

        const sync = async () => {
          try {
            const response = await fetch(`${base}/state${suffix}`, { headers: { accept: 'application/json' }, cache: 'no-store' })
            if (!response.ok) throw new Error(`Host 返回 HTTP ${response.status}`)
            const frame = await response.json()
            if (disposed) return
            setState(current => ({ ...current, status: 'live', error: null, view: reduceView(current.view, frame) }))
          } catch (error) {
            if (disposed) return
            setState(current => ({ ...current, status: 'error', error: error instanceof Error ? error.message : String(error) }))
          }
        }

        const connect = () => {
          if (disposed) return
          try {
            source = new EventSource(`${base}/events${suffix}`)
          } catch {
            retry = setTimeout(connect, 2000)
            return
          }
          source.onopen = () => {
            if (disposed) return
            setState(current => ({ ...current, status: 'live', error: null }))
          }
          source.onmessage = event => {
            if (disposed) return
            let frame
            try {
              frame = JSON.parse(event.data)
            } catch {
              return
            }
            setState(current => ({ ...current, status: 'live', error: null, view: reduceView(current.view, frame) }))
          }
          source.onerror = () => {
            if (disposed) return
            setState(current => (current.status === 'live' ? { ...current, status: 'reconnecting' } : current))
          }
        }

        // Probe once which prefix the mounted host answers, then fetch and
        // stream against it.
        void resolveApiBase().then(resolved => {
          if (disposed) return
          base = resolved
          void sync()
          connect()
        })
        return () => {
          disposed = true
          if (retry !== null) clearTimeout(retry)
          if (source !== null) source.close()
        }
      }, [resyncToken, sessionId])
      return state
    }

    /** A 1s tick, so "进行中 12s" actually counts without re-rendering the world. */
    function useNow(active) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!active) return undefined
        const timer = setInterval(() => { setNow(Date.now()) }, 1000)
        return () => { clearInterval(timer) }
      }, [active])
      return now
    }

    function LevelChip({ level, children }) {
      const meta = LEVELS[level] ?? LEVELS.display
      return h('span', { className: 'sd-chip', 'data-tone': level === 'display' ? 'display' : level }, h('span', { 'aria-hidden': 'true' }, meta.emoji), children ?? meta.label)
    }

    function StatTile({ level, count }) {
      const meta = LEVELS[level]
      return h('div', { className: 'sd-stat' },
        h('b', { style: { color: meta.color } }, String(count ?? 0)),
        h('span', null, `${meta.emoji} ${meta.label}`))
    }

    function CurrentCard({ current, now, config }) {
      if (current === null || current === undefined) {
        return h('div', { className: 'sd-card' },
          h('div', { className: 'sd-empty' }, '等待 Agent 的第一个动作…'),
          h('div', { className: 'sd-sub', style: { textAlign: 'center' } }, '本面板只观察，不拦截；命令与读取不计入范围判定。'))
      }
      const meta = LEVELS[current.level] ?? LEVELS.display
      const running = current.state === 'running'
      const target = Array.isArray(current.targets) && current.targets.length > 0 ? current.targets[0].path : current.summary
      return h('div', { className: 'sd-card' },
        h('div', { className: 'sd-current' },
          h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('span', { className: 'sd-level', style: { color: meta.color } }, `${meta.emoji} ${meta.label}`),
              h('span', { className: 'sd-tool sd-mono' }, current.tool),
              current.variant !== 'others' ? h('span', { className: 'sd-chip' }, current.variant) : null,
              current.milestone !== null ? h('span', { className: 'sd-chip' }, `里程碑 ${current.milestone}`) : null,
              current.task !== null ? h('span', { className: 'sd-chip' }, `任务 ${current.task}`) : null),
            h('div', { className: 'sd-target sd-mono', title: target }, target ?? ''),
            h('div', { className: 'sd-sub' }, current.reason ?? '')),
          h('div', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
            h('div', { className: 'sd-sub' }, running ? '进行中' : current.failed === true ? '失败' : '完成'),
            h('div', { style: { fontSize: 12, fontVariantNumeric: 'tabular-nums' } },
              running ? (current.at === null ? '' : age(current.at, now)) : duration(current.ms) || clock(current.at)),
            current.at !== null ? h('div', { className: 'sd-sub' }, clock(current.at)) : null)))
    }

    function HealthBar({ health }) {
      const counts = health?.counts ?? { green: 0, red: 0, yellow: 0, display: 0 }
      const total = Math.max(1, health?.total ?? 0)
      const ratio = health?.driftRatio ?? 0
      return h('div', { className: 'sd-card', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { className: 'sd-stats' },
          h(StatTile, { level: 'green', count: counts.green }),
          h(StatTile, { level: 'yellow', count: counts.yellow }),
          h(StatTile, { level: 'red', count: counts.red }),
          h(StatTile, { level: 'display', count: counts.display })),
        h('div', { className: 'sd-bar' },
          ['green', 'yellow', 'red', 'display'].map(level => h('i', {
            key: level,
            style: { width: `${((counts[level] ?? 0) / total) * 100}%`, background: LEVELS[level].color },
          }))),
        h('div', { className: 'sd-sub' },
          `判定 ${health?.judged ?? 0} 次 · 偏离 ${health?.drifted ?? 0} 次 · 偏离率 ${(ratio * 100).toFixed(0)}%`,
          health?.startedAt !== undefined ? ` · 观察始于 ${clock(health.startedAt)}` : ''))
    }

    function EventRow({ event }) {
      const meta = LEVELS[event.level] ?? LEVELS.display
      const target = Array.isArray(event.targets) && event.targets.length > 0 ? event.targets.map(item => item.path).join(' · ') : event.summary
      return h('div', { className: 'sd-row', title: event.reason ?? '' },
        h('span', { className: 'sd-when sd-mono' }, clock(event.at)),
        h('span', { style: { minWidth: 18 }, 'aria-hidden': 'true' }, meta.emoji),
        h('span', { className: 'sd-what' },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' } },
            h('span', { className: 'sd-mono', style: { fontWeight: 600 } }, event.tool),
            event.state === 'running' ? h('span', { className: 'sd-chip' }, '进行中') : null,
            event.failed === true ? h('span', { className: 'sd-chip', 'data-tone': 'red' }, '失败') : null,
            event.milestone !== null && event.milestone !== undefined ? h('span', { className: 'sd-chip' }, event.milestone) : null),
          h('div', { className: 'sd-target sd-mono', style: { opacity: 0.8 } }, target ?? '')),
        h('span', { className: 'sd-sub', style: { whiteSpace: 'nowrap' } }, event.ms !== null && event.ms !== undefined ? duration(event.ms) : ''))
    }

    function AlertRow({ alert }) {
      const meta = LEVELS[alert.level] ?? LEVELS.display
      return h('div', { className: 'sd-row', title: alert.reason ?? '' },
        h('span', { style: { minWidth: 18 }, 'aria-hidden': 'true' }, meta.emoji),
        h('span', { className: 'sd-what' },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' } },
            h('span', { className: 'sd-mono', style: { fontWeight: 600 } }, alert.tool),
            h('span', { className: 'sd-target sd-mono' }, alert.target ?? ''),
            alert.count > 1 ? h('span', { className: 'sd-count' }, `×${alert.count}`) : null),
          h('div', { className: 'sd-sub' }, alert.reason ?? '')),
        h('span', { className: 'sd-sub sd-mono', style: { whiteSpace: 'nowrap' } }, clock(alert.lastAt)))
    }

    /* ============================ 路线图（git-graph） ============================ */

    /** Uniform row height: y coordinates of every node derive from it. */
    const MAP_ROW_H = 34
    /** Node columns by depth: 0 trunk (milestones), 1 tasks, 2 deviations/live. */
    const MAP_COLS = [18, 46, 76]

    /**
     * The map's four inks, so "planned / achieved / current / drifted" each
     * own one color everywhere: trunk, rings, labels and legend all read from
     * this table and nowhere else.
     */
    const MAP_COLORS = {
      /** 规划中的路线（主干、未开始的任务、空进度）。 */
      plan: '#818cf8',
      /** 已实现。 */
      done: '#22c55e',
      /** 当前位置与进行中。 */
      doing: '#3b82f6',
      red: '#ef4444',
      yellow: '#f59e0b',
    }

    function mapProgress(milestone) {
      const total = Array.isArray(milestone?.tasks) ? milestone.tasks.length : 0
      const done = total === 0 ? 0 : milestone.tasks.filter(task => task.status === 'done').length
      return { done, total, frac: total === 0 ? 0 : done / total }
    }

    /**
     * Fill in roadmap states when the connected host predates `status`
     * support (the host strips unknown config fields, and its ESM module
     * cache survives a plugin toggle). With an up-to-date host this is a
     * no-op; with an old one the map still marks the current position from
     * `activeTaskId` instead of rendering everything hollow.
     */
    function enrichRoadmap(document_) {
      if (document_ === null || document_ === undefined) return document_
      const milestones = document_.milestones
      if (!Array.isArray(milestones)) return document_
      const hasStatus = milestones.some(entry => Array.isArray(entry.tasks) && entry.tasks.some(task => task.status !== undefined))
      if (hasStatus) return document_
      const headId = document_.activeTaskId ?? null
      const enriched = milestones.map(entry => {
        const tasks = (Array.isArray(entry.tasks) ? entry.tasks : []).map(task => ({
          ...task,
          status: headId !== null && task.id === headId ? 'doing' : 'todo',
        }))
        return {
          ...entry,
          status: tasks.some(task => task.status === 'doing') ? 'doing' : 'todo',
          tasks,
        }
      })
      return { ...document_, milestones: enriched }
    }

    /**
     * Flatten the roadmap into uniform rows the map can lay out.
     *
     * Depth drives the node column: milestones sit on the trunk, their tasks
     * on the first branch lane, and the live action sprouts off the task being
     * worked on — the only thing the map says about the present. Deviations
     * are deliberately NOT rows: they used to fan out into a spider web of
     * curves; now they live in the alert queue and the slimbar counts.
     */
    function autoCollapseIds(document_) {
      return new Set((document_?.milestones ?? []).filter(entry => entry.status === 'done' && entry.key !== true).map(entry => entry.id))
    }

    function buildMapRows(document_, current, collapsedSet) {
      const rows = [{ kind: 'root', depth: 0, document_ }]
      const milestones = Array.isArray(document_?.milestones) ? document_.milestones : []
      for (const milestone of milestones) {
        const head = milestone.tasks.find(task => task.status === 'doing') ?? null
        const folded = collapsedSet !== null && collapsedSet !== undefined && collapsedSet.has(milestone.id)
        rows.push({ kind: 'milestone', depth: 0, milestone, folded, children: milestone.tasks.length })
        if (folded) continue
        for (const task of milestone.tasks) {
          rows.push({ kind: 'task', depth: 1, milestone, task })
          if (task === head && current !== null && current !== undefined) {
            rows.push({ kind: 'live', depth: 2, current })
          }
        }
      }
      return rows
    }

    const mapY = index => index * MAP_ROW_H + MAP_ROW_H / 2

    /**
     * Progress ring node: track + colored arc; when `done` it becomes a solid
     * disc with a white check, so "已实现" reads without reading any text.
     */
    function MapRing({ cx, cy, frac, color, done }) {
      const radius = 7
      const circumference = 2 * Math.PI * radius
      return h(React.Fragment, null,
        h('circle', { cx, cy, r: radius, fill: 'none', stroke: 'var(--sd-line)', strokeWidth: 2.5 }),
        done
          ? h(React.Fragment, null,
            h('circle', { cx, cy, r: radius, fill: MAP_COLORS.done }),
            h('path', {
              d: `M ${cx - 3} ${cy + 0.3} L ${cx - 0.9} ${cy + 2.6} L ${cx + 3.3} ${cy - 2.4}`,
              fill: 'none', stroke: 'rgba(255,255,255,.95)', strokeWidth: 1.7,
              strokeLinecap: 'round', strokeLinejoin: 'round',
            }))
          : frac > 0
            ? h('circle', {
              cx, cy, r: radius, fill: 'none', stroke: color, strokeWidth: 2.5,
              strokeDasharray: `${frac * circumference} ${circumference}`,
              strokeLinecap: 'round', transform: `rotate(-90 ${cx} ${cy})`,
            })
            : null)
    }

    /** A white check on a filled disc — the "done" mark shared by all nodes. */
    function DoneCheck({ cx, cy, radius }) {
      const k = radius / 5.5
      return h('path', {
        d: `M ${cx - 2.4 * k} ${cy + 0.3 * k} L ${cx - 0.7 * k} ${cy + 2.1 * k} L ${cx + 2.6 * k} ${cy - 1.9 * k}`,
        fill: 'none', stroke: 'rgba(255,255,255,.95)', strokeWidth: 1.5 * k,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      })
    }

    /** All SVG ink for the map: trunk, branch lanes, deviation curves, nodes. */
    function MapLines({ rows }) {
      const ink = []
      const byKind = index => rows[index]
      const milestoneIndexes = []
      let currentIndex = -1
      rows.forEach((row, index) => {
        if (row.kind === 'milestone') milestoneIndexes.push(index)
        if (row.kind === 'root') milestoneIndexes.push(index)
        if (row.kind === 'milestone' && row.milestone.status === 'doing') currentIndex = index
      })
      // Trunk in two inks: the walked part (root → current milestone) in the
      // achieved color, the road ahead in the plan color.
      if (milestoneIndexes.length > 1) {
        const top = mapY(milestoneIndexes[0])
        const bottom = mapY(milestoneIndexes[milestoneIndexes.length - 1])
        if (currentIndex > 0) {
          ink.push(h('line', { key: 'trunk-walked', x1: MAP_COLS[0], y1: top, x2: MAP_COLS[0], y2: mapY(currentIndex), stroke: MAP_COLORS.done, strokeWidth: 2.5, opacity: 0.85 }))
          if (mapY(currentIndex) < bottom) {
            ink.push(h('line', { key: 'trunk-plan', x1: MAP_COLS[0], y1: mapY(currentIndex), x2: MAP_COLS[0], y2: bottom, stroke: MAP_COLORS.plan, strokeWidth: 2, opacity: 0.55 }))
          }
        } else {
          ink.push(h('line', { key: 'trunk-plan', x1: MAP_COLS[0], y1: top, x2: MAP_COLS[0], y2: bottom, stroke: MAP_COLORS.plan, strokeWidth: 2, opacity: 0.55 }))
        }
      }
      rows.forEach((row, index) => {
        if (row.kind !== 'milestone') return
        // Collect this milestone's contiguous task block.
        const taskIndexes = []
        for (let scan = index + 1; scan < rows.length; scan += 1) {
          if (byKind(scan).depth <= 0) break
          if (byKind(scan).kind === 'task') taskIndexes.push(scan)
        }
        if (taskIndexes.length === 0) return
        const first = taskIndexes[0]
        const last = taskIndexes[taskIndexes.length - 1]
        const laneColor = row.milestone.status === 'done' ? MAP_COLORS.done : row.milestone.status === 'doing' ? MAP_COLORS.doing : MAP_COLORS.plan
        const laneOpacity = row.milestone.status === 'todo' ? 0.4 : 0.55
        const d = `M ${MAP_COLS[0]} ${mapY(index)} C ${MAP_COLS[0]} ${mapY(index) + 10}, ${MAP_COLS[1]} ${mapY(first) - 12}, ${MAP_COLS[1]} ${mapY(first)}`
        ink.push(h('path', { key: `lane-${row.milestone.id}`, d, fill: 'none', stroke: laneColor, strokeWidth: 2, opacity: laneOpacity }))
        if (last > first) {
          ink.push(h('line', {
            key: `lane-line-${row.milestone.id}`,
            x1: MAP_COLS[1], y1: mapY(first), x2: MAP_COLS[1], y2: mapY(last),
            stroke: laneColor, strokeWidth: 2, opacity: laneOpacity,
          }))
        }
      })
      rows.forEach((row, index) => {
        // Only the live action still gets a sprouting curve — the dashed
        // "this is happening now" twig. Deviation curves are gone: the map
        // stays a plan, not a spider web.
        if (row.kind !== 'live') return
        // Parent = nearest shallower row above (the task it hangs on).
        let parent = index - 1
        while (parent > 0 && rows[parent].depth >= row.depth) parent -= 1
        const x1 = MAP_COLS[rows[parent].depth]
        const x2 = MAP_COLS[row.depth]
        const y1 = mapY(parent)
        const y2 = mapY(index)
        const dip = Math.max(8, (y2 - y1) * 0.55)
        ink.push(h('path', {
          key: `dev-${index}`,
          d: `M ${x1} ${y1} C ${x1} ${y1 + dip}, ${x2} ${y2 - dip}, ${x2} ${y2}`,
          fill: 'none', stroke: MAP_COLORS.doing, strokeWidth: 1.4,
          strokeDasharray: '3 4', opacity: 0.85,
        }))
      })
      // Nodes on top of the lines.
      rows.forEach((row, index) => {
        const cx = MAP_COLS[row.depth]
        const cy = mapY(index)
        const key = `node-${index}`
        if (row.kind === 'root') {
          const total = (row.document_?.milestones ?? []).reduce((sum, m) => sum + mapProgress(m).total, 0)
          const done = (row.document_?.milestones ?? []).reduce((sum, m) => sum + mapProgress(m).done, 0)
          ink.push(h(MapRing, { key, cx, cy, frac: total === 0 ? 0 : done / total, color: MAP_COLORS.done, done: total > 0 && done === total }))
        } else if (row.kind === 'milestone') {
          const progress = mapProgress(row.milestone)
          const isDone = row.milestone.status === 'done'
          if (row.milestone.key === true) {
            ink.push(h('circle', { key: `${key}-keyring`, cx, cy, r: 10.5, fill: 'none', stroke: '#f5c518', strokeWidth: 1, strokeDasharray: '2 3', opacity: 0.9 }))
          }
          ink.push(h(MapRing, {
            key, cx, cy, frac: progress.frac,
            color: isDone ? MAP_COLORS.done : row.milestone.status === 'doing' ? MAP_COLORS.doing : MAP_COLORS.plan,
            done: isDone,
          }))
          if (row.milestone.status === 'doing') {
            ink.push(h('circle', { key: `${key}-head`, cx, cy, r: 2.5, fill: MAP_COLORS.doing }))
          }
        } else if (row.kind === 'task') {
          const status = row.task.status ?? 'todo'
          if (status === 'done') {
            ink.push(h('circle', { key, cx, cy, r: 5.5, fill: MAP_COLORS.done }))
            ink.push(h(DoneCheck, { key: `${key}-check`, cx, cy, radius: 5.5 }))
          } else if (status === 'doing') {
            ink.push(h('circle', { key: `${key}-halo`, className: 'sd-halo', cx, cy, r: 7, fill: 'none', stroke: MAP_COLORS.doing, strokeWidth: 2 }))
            ink.push(h('circle', { key, cx, cy, r: 5.5, fill: 'var(--sd-surface)', stroke: MAP_COLORS.doing, strokeWidth: 2.5 }))
          } else {
            ink.push(h('circle', { key, cx, cy, r: 5, fill: 'none', stroke: MAP_COLORS.plan, strokeWidth: 2, strokeOpacity: 0.65 }))
          }
        }
      })
      return h('svg', { className: 'sd-map-lines', width: '100%', height: rows.length * MAP_ROW_H }, ink)
    }

    function MapLabel({ row, onToggleFold, folded }) {
      if (row.kind === 'root') {
        const milestones = row.document_?.milestones ?? []
        const total = milestones.reduce((sum, m) => sum + mapProgress(m).total, 0)
        const done = milestones.reduce((sum, m) => sum + mapProgress(m).done, 0)
        const frac = total === 0 ? 0 : done / total
        return h('div', { className: 'sd-map-label' },
          h('b', { className: 'sd-map-title-main' }, row.document_?.project ?? 'Roadmap'),
          h('span', {
            className: 'sd-state',
            style: { color: frac >= 1 ? MAP_COLORS.done : MAP_COLORS.plan },
          }, frac >= 1 ? '已交付' : frac > 0 ? '进行中' : '规划中'),
          h('span', { className: 'sd-sub' }, frac >= 1 ? '全部完成' : `${done}/${total} · ${Math.round(frac * 100)}%`))
      }
      if (row.kind === 'milestone') {
        const progress = mapProgress(row.milestone)
        const isDone = row.milestone.status === 'done'
        const isDoing = row.milestone.status === 'doing'
        const stateText = isDone ? '已交付' : isDoing ? '进行中' : '未开始'
        const anchorColor = isDone ? MAP_COLORS.done : isDoing ? MAP_COLORS.doing : MAP_COLORS.plan
        return h('div', { className: 'sd-map-label' },
          row.children > 0 ? h('button', {
            type: 'button',
            className: 'sd-caret',
            title: folded === true ? '展开任务分支' : '折叠任务分支',
            onClick: event => {
              event.stopPropagation()
              onToggleFold(row.milestone.id)
            },
          }, folded === true ? '▸' : '▾') : h('span', { style: { width: 16, flex: '0 0 auto' } }),
          h('span', {
            className: 'sd-state',
            style: { color: anchorColor },
          }, stateText),
          row.milestone.key === true ? h('span', { className: 'sd-star', title: '关键里程碑：项目主线，不会被自动折叠' }, '★') : null,
          h('span', { className: 'sd-map-title-main' }, row.milestone.title === '' ? '（未命名）' : row.milestone.title),
          h('span', { className: 'sd-mid', style: { color: anchorColor, borderColor: anchorColor, opacity: .95 } }, row.milestone.id),
          isDone
            ? h('span', { className: 'sd-sub' }, '全部完成')
            : h('span', { className: 'sd-sub' }, `${progress.done}/${progress.total}`))
      }
      if (row.kind === 'task') {
        const status = row.task.status ?? 'todo'
        const stateText = status === 'done' ? '已交付' : status === 'doing' ? '进行中' : '未开始'
        return h('div', { className: 'sd-map-label', title: row.task.title },
          h('span', {
            className: 'sd-state',
            style: { color: status === 'done' ? MAP_COLORS.done : status === 'doing' ? MAP_COLORS.doing : undefined },
          }, stateText),
          h('span', { style: status === 'done' ? { opacity: 0.85 } : status === 'doing' ? { fontWeight: 600 } : null }, row.task.title === '' ? '（未命名）' : row.task.title),
          status === 'doing' ? h('span', { className: 'sd-chip', style: { color: MAP_COLORS.doing, borderColor: 'rgba(59,130,246,.5)' } }, '◀ 现在') : null)
      }
      // 'live' rows render their own inline label in RoadmapMap; there are no
      // other row kinds — deviations are queue material, not map rows.
      return null
    }

    /** One-line legend: the three inks plus the key star, so either view reads unaided. */
    function MapLegend() {
      const item = (swatch, label) => h('span', { key: label, className: 'sd-legend-item' }, swatch, label)
      return h('div', { className: 'sd-map-legend' },
        item(h('span', { className: 'sd-legend-bar', style: { background: MAP_COLORS.plan } }), '规划主线'),
        item(h('span', { className: 'sd-legend-dot', style: { background: MAP_COLORS.done } }), '已实现'),
        item(h('span', { className: 'sd-legend-ring', style: { borderColor: MAP_COLORS.doing } }), '当前'),
        item(h('span', { className: 'sd-star' }, '★'), '关键'))
    }

    const STATUS_TEXT = { done: '已完成', doing: '进行中', todo: '未开始' }

    function statusChip(status) {
      const color = status === 'done' ? MAP_COLORS.done : status === 'doing' ? MAP_COLORS.doing : '#9aa4b2'
      return h('span', { className: 'sd-chip', style: { color, borderColor: color } }, STATUS_TEXT[status] ?? '未开始')
    }

    /** Re-resolve a selection reference against the LIVE data on every render. */
    function resolveSelection(selected, document_, alerts) {
      if (selected === null || selected === undefined) return null
      const milestones = Array.isArray(document_?.milestones) ? document_.milestones : []
      if (selected.kind === 'task') {
        const milestone = milestones.find(entry => entry.id === selected.milestoneId)
        const task = milestone?.tasks.find(entry => entry.id === selected.taskId)
        return task === undefined ? null : { kind: 'task', milestone, task }
      }
      if (selected.kind === 'milestone') {
        const milestone = milestones.find(entry => entry.id === selected.milestoneId)
        return milestone === undefined ? null : { kind: 'milestone', milestone }
      }
      if (selected.kind === 'alert') {
        const alert = alerts.find(entry => entry.key === selected.alertKey)
        return alert === undefined ? null : { kind: 'alert', alert }
      }
      return null
    }
    /**
     * The click-through card: what a node IS, and the evidence behind it —
     * acceptance criteria for tasks, scope lists for milestones.
     */
    function NodeDetail({ selection, alerts, onClose, onToggleFold, folded }) {
      if (selection === null) return null
      const head = (title, extra) => h('div', { className: 'sd-detail-head' },
        h('span', { className: 'sd-chip' }, title),
        extra ?? null,
        h('button', { type: 'button', className: 'sd-btn sd-detail-close', onClick: onClose }, '✕ 关闭'))
      if (selection.kind === 'task') {
        const { milestone, task } = selection
        const related = alerts.filter(alert => alert.milestone === milestone.id).slice(0, 6)
        return h('div', { className: 'sd-detail' },
          head(`任务 ${task.id}`, statusChip(task.status)),
          h('div', { style: { fontWeight: 600, marginBottom: 4 } }, task.title === '' ? '（未命名）' : task.title),
          h('div', { className: 'sd-sub' }, `归属里程碑：${milestone.id}${milestone.title === '' ? '' : ` · ${milestone.title}`}`),
          task.acceptance.length > 0 ? h('div', { style: { marginTop: 6 } },
            h('div', { className: 'sd-h4' }, '验收标准'),
            h('ul', { className: 'sd-list' }, task.acceptance.map((item, index) => h('li', {
              key: index,
            }, item, h('span', { className: 'sd-untested' }, '未验证'))))) : null,
          related.length > 0 ? h('div', { style: { marginTop: 6 } },
            h('div', { className: 'sd-h4' }, '本里程碑偏离'),
            related.map(alert => h('div', { key: alert.key, className: 'sd-sub' },
              `${alert.level === 'red' ? '⛔' : '⚠'} ${alert.tool} · ${alert.target}${alert.count > 1 ? ` ×${alert.count}` : ''}`))) : null)
      }
      if (selection.kind === 'milestone') {
        const { milestone } = selection
        const progress = mapProgress(milestone)
        return h('div', { className: 'sd-detail' },
          head(`里程碑 ${milestone.id}`, statusChip(milestone.status)),
          h('div', { style: { fontWeight: 600, marginBottom: 4 } },
            milestone.title === '' ? '（未命名）' : milestone.title,
            milestone.key === true ? h('span', { className: 'sd-star', style: { marginLeft: 6 } }, '★ 关键') : null),
          h('div', { className: 'sd-sub' }, `进度 ${progress.done}/${progress.total}`),
          h('div', { style: { marginTop: 6 } },
            h('div', { className: 'sd-h4' }, '允许清单'),
            milestone.allow.length === 0 ? h('div', { className: 'sd-sub' }, '（空）') : h('ul', { className: 'sd-list' }, milestone.allow.map(entry => h('li', { key: entry, className: 'sd-mono' }, entry))),
            h('div', { className: 'sd-h4', style: { marginTop: 6 } }, '禁止清单'),
            milestone.forbid.length === 0 ? h('div', { className: 'sd-sub' }, '（空）') : h('ul', { className: 'sd-list' }, milestone.forbid.map(entry => h('li', { key: entry, className: 'sd-mono' }, entry)))),
          milestone.tasks.length > 0 ? h('div', { style: { marginTop: 6 } },
            h('div', { className: 'sd-h4' }, '任务'),
            milestone.tasks.map(task => h('div', { key: task.id, className: 'sd-sub', style: { display: 'flex', gap: 6 } },
              h('span', { style: { color: task.status === 'done' ? MAP_COLORS.done : task.status === 'doing' ? MAP_COLORS.doing : undefined } }, task.status === 'done' ? '✓' : task.status === 'doing' ? '●' : '○'),
              h('span', { className: 'sd-mono' }, task.id),
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, task.title)))) : null,
          h('div', { style: { marginTop: 8 } },
            h('button', { type: 'button', className: 'sd-btn', onClick: () => { onToggleFold(milestone.id) } },
              folded === true ? '展开任务分支 ▸' : '折叠任务分支 ▾')))
      }
      return null
    }

    /**
     * The roadmap itself: a git-graph trunk of milestones and tasks, with the
     * live action hanging off the current one. Fold delivered milestones,
     * click any node for its evidence, zoom when the column is narrow.
     * Deviations are not drawn here — they read from the alert queue and the
     * slimbar counts instead of spider-webbing across the plan.
     */
    /**
     * The same roadmap as a workflow graph: a layered canvas of project →
     * milestone → task cards over dotted paper — the shape the right sidebar's
     * task page gives its workflow view.
     *
     * It keeps that page's reading rules rather than inventing new ones: a
     * fixed 190px card, sibling bands that WRAP instead of shrinking below a
     * 0.78 readability floor, drag-to-pan on the background only, wheel zoom at
     * the cursor, and a control cluster with −/%/+/fit. A narrow panel must
     * stay legible, not become a thumbnail.
     */
    const G_NODE_W = 190
    const G_NODE_H = 88
    const G_GAP_X = 28
    const G_GAP_Y = 48
    const G_PAD = 16
    const G_FIT_MIN = 0.78
    const G_FIT_MAX = 1.4
    const G_FIT_MARGIN = 24
    const G_ZOOM_MIN = 0.4
    const G_ZOOM_MAX = 2
    const G_CLICK_SLOP = 4

    /** Split a sibling list into bands of at most `cols` — the wrap rule. */
    function bands(items, cols) {
      const out = []
      for (let index = 0; index < items.length; index += cols) out.push(items.slice(index, index + cols))
      return out
    }

    /** project → milestones → tasks as one node tree (folded milestones lose their children). */
    function graphNodes(document_, collapsedSet) {
      const root = { id: '__root__', kind: 'root', children: [] }
      const milestones = Array.isArray(document_?.milestones) ? document_.milestones : []
      for (const milestone of milestones) {
        const folded = collapsedSet.has(milestone.id)
        const node = { id: milestone.id, kind: 'milestone', milestone, folded, children: [] }
        root.children.push(node)
        if (folded) continue
        for (const task of milestone.tasks) {
          node.children.push({ id: `${milestone.id}/${task.id}`, kind: 'task', milestone, task, children: [] })
        }
      }
      return root
    }

    /** Tidy-tree pass: every node centred over its children, siblings wrapped into bands. */
    function layoutGraph(root, cols) {
      const subtreeWidth = node => {
        if (node.children.length === 0) return G_NODE_W
        let widest = G_NODE_W
        for (const band of bands(node.children, cols)) {
          let width = G_GAP_X * (band.length - 1)
          for (const child of band) width += subtreeWidth(child)
          if (width > widest) widest = width
        }
        return widest
      }
      const boxes = new Map()
      const place = (node, centerX, row) => {
        boxes.set(node.id, {
          x: Math.round(centerX - G_NODE_W / 2),
          y: G_PAD + row * (G_NODE_H + G_GAP_Y),
          w: G_NODE_W,
          h: G_NODE_H,
        })
        if (node.children.length === 0) return row
        let deepest = row
        let bandRow = row + 1
        for (const band of bands(node.children, cols)) {
          let bandWidth = G_GAP_X * (band.length - 1)
          for (const child of band) bandWidth += subtreeWidth(child)
          let cursor = centerX - bandWidth / 2
          let bandDeepest = bandRow
          for (const child of band) {
            const width = subtreeWidth(child)
            bandDeepest = Math.max(bandDeepest, place(child, cursor + width / 2, bandRow))
            cursor += width + G_GAP_X
          }
          deepest = Math.max(deepest, bandDeepest)
          bandRow = bandDeepest + 1
        }
        return deepest
      }
      place(root, G_PAD + subtreeWidth(root) / 2, 0)
      let width = G_PAD * 2 + G_NODE_W
      let height = G_PAD * 2 + G_NODE_H
      for (const box of boxes.values()) {
        width = Math.max(width, box.x + box.w + G_PAD)
        height = Math.max(height, box.y + box.h + G_PAD)
      }
      return { boxes, width, height }
    }

    /**
     * Keep the branch topology independent of viewport measurement. Switching
     * tree/flow remounts the canvas; a zero or narrow width must not turn the
     * same roadmap into a single-column ladder. Viewport fit/pan owns sizing.
     */
    function layoutForWidth(root, _containerWidth) {
      return layoutGraph(root, 2)
    }

    /**
     * Where the canvas should sit on open.
     *
     * The scale PREFERS the height fit, letting the width spill at most 15%
     * (the canvas pans, so a slightly wider graph is fine). Fitting width only
     * left a tall panel a third empty under a short tree — exactly "图只占了
     * 上半部分". The readability floor still wins over both: a graph too large
     * to fit keeps the floor and pans.
     */
    function fitTransform(containerW, containerH, layoutW, layoutH) {
      const kHeight = (containerH - G_FIT_MARGIN * 2) / Math.max(1, layoutH)
      const kWidth = (containerW - G_FIT_MARGIN * 2) / Math.max(1, layoutW)
      const k = Math.min(G_FIT_MAX, Math.max(G_FIT_MIN, Math.min(kHeight, kWidth * 1.15)))
      const contentW = layoutW * k
      const contentH = layoutH * k
      return {
        x: Math.round((containerW - contentW) / 2),
        y: contentH > containerH ? 0 : Math.round((containerH - contentH) / 2),
        k,
      }
    }

    /** A connector: perpendicular stub out of the parent, one bezier, stub in. */
    function graphEdgePath(from, to) {
      const x1 = from.x + from.w / 2
      const y1 = from.y + from.h
      const x2 = to.x + to.w / 2
      const y2 = to.y
      const span = Math.max(0, y2 - y1)
      const stub = Math.min(8, span / 3)
      const dy = Math.max(14, (span - stub * 2) / 2)
      return `M ${x1} ${y1} L ${x1} ${y1 + stub} C ${x1} ${y1 + stub + dy} ${x2} ${y2 - stub - dy} ${x2} ${y2 - stub} L ${x2} ${y2}`
    }

    function RoadmapFlow({ document_, current, collapsedSet, toggleFold, selected, onSelect }) {
      const containerRef = React.useRef(null)
      const [size, setSize] = React.useState({ w: 0, h: 0 })
      const [tf, setTf] = React.useState({ x: 0, y: 0, k: 1 })
      const [dragging, setDragging] = React.useState(false)
      const touchedRef = React.useRef(false)
      const travelRef = React.useRef(0)
      const tfRef = React.useRef(tf)
      tfRef.current = tf

      const milestones = Array.isArray(document_?.milestones) ? document_.milestones : []
      const rootNode = graphNodes(document_, collapsedSet)
      const layout = layoutForWidth(rootNode, size.w)
      const boxes = layout.boxes

      // Measure before paint; keep observing subsequent panel resizes.
      React.useLayoutEffect(() => {
        const element = containerRef.current
        if (element === null) return
        const measure = () => {
          const w = element.clientWidth
          const h = element.clientHeight
          if (w <= 0 || h <= 0) return
          setSize(previous => (previous.w === w && previous.h === h ? previous : { w, h }))
        }
        measure()
        if (typeof ResizeObserver !== 'function') return
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => { observer.disconnect() }
      }, [])

      // Keep auto-fitting while the reader has not taken the view (and refit a
      // freshly loaded roadmap), so a resize never leaves the graph off-screen.
      React.useLayoutEffect(() => {
        if (size.w === 0 || size.h === 0 || touchedRef.current) return
        setTf(fitTransform(size.w, size.h, layout.width, layout.height))
      }, [size.w, size.h, layout.width, layout.height, document_])

      // Wheel zoom at the cursor (non-passive: the page must not scroll under it).
      React.useEffect(() => {
        const element = containerRef.current
        if (element === null) return
        const onWheel = event => {
          event.preventDefault()
          const rect = element.getBoundingClientRect()
          const mx = event.clientX - rect.left
          const my = event.clientY - rect.top
          // Devices report pixels, lines or pages; normalise or a line-scrolling
          // mouse zooms far slower than a trackpad.
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
          const from = tfRef.current
          const next = Math.min(G_ZOOM_MAX, Math.max(G_ZOOM_MIN, from.k * Math.exp(-event.deltaY * unit * 0.0014)))
          if (next === from.k) return
          touchedRef.current = true
          setTf({ x: mx - (mx - from.x) * (next / from.k), y: my - (my - from.y) * (next / from.k), k: next })
        }
        element.addEventListener('wheel', onWheel, { passive: false })
        return () => { element.removeEventListener('wheel', onWheel) }
      }, [])

      const zoomBy = factor => {
        const from = tfRef.current
        const next = Math.min(G_ZOOM_MAX, Math.max(G_ZOOM_MIN, from.k * factor))
        if (next === from.k) return
        touchedRef.current = true
        const mx = (size.w || 0) / 2
        const my = (size.h || 0) / 2
        setTf({ x: mx - (mx - from.x) * (next / from.k), y: my - (my - from.y) * (next / from.k), k: next })
      }

      const refit = () => {
        touchedRef.current = false
        setTf(fitTransform(size.w || 360, size.h || 320, layout.width, layout.height))
      }

      // Drag-pan from the BACKGROUND only — a pan that starts on a card would
      // swallow the card's own click.
      const onPointerDown = event => {
        if (event.button !== 0) return
        const target = event.target
        if (target !== null && typeof target.closest === 'function'
          && (target.closest('[data-gnode]') !== null || target.closest('[data-gcontrols]') !== null)) return
        travelRef.current = 0
        const startX = event.clientX
        const startY = event.clientY
        const from = tfRef.current
        const onMove = move => {
          const dx = move.clientX - startX
          const dy = move.clientY - startY
          travelRef.current = Math.max(travelRef.current, Math.abs(dx) + Math.abs(dy))
          if (travelRef.current <= G_CLICK_SLOP) return
          touchedRef.current = true
          setDragging(true)
          setTf(latest => ({ x: from.x + dx, y: from.y + dy, k: latest.k }))
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          setDragging(false)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      }

      const clickAllowed = () => travelRef.current <= G_CLICK_SLOP

      if (milestones.length === 0) return h('div', { className: 'sd-empty' }, '尚未配置里程碑，请先接入项目路线图。')

      const picked = (kind, milestoneId, taskId) => selected?.kind === kind && selected?.milestoneId === milestoneId && (kind !== 'task' || selected?.taskId === taskId)
      // The live action belongs to ONE node: the first task still marked doing.
      let headKey = null
      for (const milestone of milestones) {
        for (const task of milestone.tasks) {
          if (headKey === null && (task.status ?? 'todo') === 'doing') headKey = `${milestone.id}/${task.id}`
        }
      }

      const card = (key, box, options) => h('button', {
        key,
        type: 'button',
        className: 'sd-gnode' + (options.kind === 'task' ? ' sd-gnode-task' : ''),
        'data-gnode': options.id,
        'data-selected': String(options.selected === true),
        'data-current': String(options.active === true),
        style: { left: box.x, top: box.y, width: box.w, height: box.h, '--sd-accent': options.accent },
        title: options.title,
        onClick: () => { if (clickAllowed()) options.onClick() },
      },
      h('span', { className: 'sd-gbadges' }, options.badges),
      h('span', { className: 'sd-gname' }, options.name),
      h('span', { className: 'sd-gbar' },
        h('span', { className: 'sd-gdot', style: { background: options.accent, opacity: options.dotOpacity ?? 1 } }),
        h('span', { className: 'sd-gbar-text' }, options.bar)))

      const total = milestones.reduce((sum, entry) => sum + mapProgress(entry).total, 0)
      const done = milestones.reduce((sum, entry) => sum + mapProgress(entry).done, 0)
      const rootBox = boxes.get('__root__')
      const nodes = [card('root', rootBox, {
        id: '__root__', kind: 'root',
        accent: done === total && total > 0 ? MAP_COLORS.done : MAP_COLORS.plan,
        title: document_?.project ?? 'Roadmap',
        name: document_?.project ?? 'Roadmap',
        badges: [h('span', { key: 'k', className: 'sd-gword' }, '项目')],
        bar: `${milestones.length} 个里程碑 · ${done}/${total} 项任务`,
        onClick: () => {},
      })]
      const paths = []
      const frames = []
      const edge = (fromId, toId, live) => {
        const from = boxes.get(fromId)
        const to = boxes.get(toId)
        if (from === undefined || to === undefined) return
        paths.push(h('path', {
          key: `${fromId}->${toId}`,
          className: 'sd-edge' + (live ? ' sd-edge-live' : ''),
          d: graphEdgePath(from, to),
        }))
      }
      for (const milestone of milestones) {
        const box = boxes.get(milestone.id)
        if (box === undefined) continue
        const progress = mapProgress(milestone)
        const folded = collapsedSet.has(milestone.id)
        const accent = milestone.status === 'done' ? MAP_COLORS.done : milestone.status === 'doing' ? MAP_COLORS.doing : MAP_COLORS.plan
        nodes.push(card(`m-${milestone.id}`, box, {
          id: milestone.id,
          kind: 'milestone',
          accent,
          selected: picked('milestone', milestone.id),
          active: milestone.status === 'doing',
          title: `${milestone.id} ${milestone.title}`,
          name: milestone.title === '' ? '（未命名）' : milestone.title,
          badges: [
            h('span', { key: 'id', className: 'sd-mid', style: { color: accent, borderColor: accent } }, milestone.id),
            statusChip(milestone.status),
            milestone.key === true ? h('span', { key: 'star', className: 'sd-star', title: '关键里程碑：项目主线，不会被自动折叠' }, '★') : null,
            folded ? h('span', { key: 'fold', className: 'sd-gword' }, '已收起') : null,
          ],
          bar: folded ? `任务 ${progress.total} 项 · 点击展开` : `任务 ${progress.done}/${progress.total} · ${Math.round(progress.frac * 100)}%`,
          onClick: () => (folded ? toggleFold(milestone.id) : onSelect({ kind: 'milestone', milestoneId: milestone.id })),
        }))
        for (const task of milestone.tasks) {
          const taskBox = boxes.get(`${milestone.id}/${task.id}`)
          if (taskBox === undefined) continue
          const status = task.status ?? 'todo'
          const taskAccent = status === 'done' ? MAP_COLORS.done : status === 'doing' ? MAP_COLORS.doing : MAP_COLORS.plan
          const isHead = headKey === `${milestone.id}/${task.id}` && current !== null && current !== undefined
          nodes.push(card(`t-${milestone.id}-${task.id}`, taskBox, {
            id: `${milestone.id}/${task.id}`,
            kind: 'task',
            accent: taskAccent,
            dotOpacity: status === 'todo' ? 0.45 : 1,
            selected: picked('task', milestone.id, task.id),
            active: status === 'doing',
            title: task.title,
            name: task.title === '' ? '（未命名）' : task.title,
            badges: [
              statusChip(status),
              isHead ? h('span', { key: 'now', className: 'sd-chip sd-now' }, '◀ 现在') : null,
            ],
            bar: isHead ? `▸ ${current.tool}` : task.id,
            onClick: () => onSelect({ kind: 'task', milestoneId: milestone.id, taskId: task.id }),
          }))
        }
        const childBoxes = milestone.tasks.map(task => boxes.get(`${milestone.id}/${task.id}`)).filter(box2 => box2 !== undefined)
        if (childBoxes.length > 0) {
          const x1 = Math.min(...childBoxes.map(entry => entry.x)) - 12
          const y1 = Math.min(...childBoxes.map(entry => entry.y)) - 20
          const x2 = Math.max(...childBoxes.map(entry => entry.x + entry.w)) + 12
          const y2 = Math.max(...childBoxes.map(entry => entry.y + entry.h)) + 12
          frames.push(h('div', {
            key: `frame-${milestone.id}`,
            className: 'sd-gframe',
            style: { left: x1, top: y1, width: x2 - x1, height: y2 - y1 },
          }, h('span', { className: 'sd-gframe-label' }, `任务清单 · ${milestone.tasks.length} 项`)))
        }
        edge('__root__', milestone.id, milestone.status === 'doing')
        for (const task of milestone.tasks) edge(milestone.id, `${milestone.id}/${task.id}`, false)
      }

      return h('div', {
        className: 'sd-graph',
        ref: containerRef,
        role: 'group',
        'aria-label': '工作流图',
        'data-dragging': String(dragging),
        onPointerDown,
        onDoubleClick: event => {
          const target = event.target
          if (target !== null && typeof target.closest === 'function' && target.closest('[data-gnode]') !== null) return
          refit()
        },
      },
      h('div', {
        className: 'sd-graph-inner',
        style: { visibility: size.w > 0 && size.h > 0 ? 'visible' : 'hidden', width: layout.width, height: layout.height, transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.k})` },
      },
      h('svg', { className: 'sd-graph-edges', width: layout.width, height: layout.height, 'aria-hidden': 'true' }, paths),
      frames,
      nodes),
      h('div', { className: 'sd-gcontrols', 'data-gcontrols': 'true' },
        h('button', { type: 'button', className: 'sd-btn', style: { padding: '0 6px' }, title: '缩小（也可滚轮）', onClick: () => { zoomBy(1 / 1.2) } }, '－'),
        h('span', { className: 'sd-gzoom' }, `${Math.round(tf.k * 100)}%`),
        h('button', { type: 'button', className: 'sd-btn', style: { padding: '0 6px' }, title: '放大（也可滚轮）', onClick: () => { zoomBy(1.2) } }, '＋'),
        h('button', { type: 'button', className: 'sd-btn', style: { padding: '0 6px' }, title: '适应窗口（双击空白处同样有效）', onClick: refit }, '⤢')))
    }

    /** The two shapes of the roadmap, and the reader's choice remembered across reloads. */
    const VIEW_MODE_KEY = 'dsh-mainline:view'
    const VIEW_MODES = [['tree', '树状图', '≡'], ['flow', '工作流图', '⇉']]

    function readViewMode() {
      try {
        const stored = window.localStorage.getItem(VIEW_MODE_KEY)
        if (stored === 'flow' || stored === 'tree') return stored
      } catch {
        /* private mode, or no storage at all */
      }
      return 'tree'
    }

    function writeViewMode(mode) {
      try {
        window.localStorage.setItem(VIEW_MODE_KEY, mode)
      } catch {
        /* the choice just stops persisting */
      }
    }

    /** Segmented switch between the trunk map and the stage flow. */
    function ViewSwitch({ mode, onChange }) {
      return h('div', { className: 'sd-seg', role: 'group', 'aria-label': '主线视图形态' },
        VIEW_MODES.map(([value, label, glyph]) => h('button', {
          key: value,
          type: 'button',
          'aria-pressed': mode === value,
          title: value === 'tree' ? '树状图：里程碑 → 任务的紧凑层级主线' : '工作流图：里程碑为阶段、任务挂在阶段下的流程图',
          onClick: () => { onChange(value) },
        },
        h('span', { 'aria-hidden': 'true', style: { fontSize: 11, opacity: .9 } }, glyph),
        label)))
    }

    function RoadmapMap({ document_, alerts, current, now }) {
      const [folded, setFolded] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const [zoom, setZoom] = React.useState(1)
      const [viewMode, setViewMode] = React.useState(readViewMode)
      const pickView = mode => {
        setViewMode(mode)
        writeViewMode(mode)
      }
      const collapsedSet = folded ?? autoCollapseIds(document_)
      const toggleFold = id => setFolded(prev => {
        const base = new Set(prev ?? autoCollapseIds(document_))
        if (base.has(id)) base.delete(id)
        else base.add(id)
        return base
      })
      const rows = buildMapRows(document_, current, collapsedSet)
      const selection = resolveSelection(selected, document_, alerts)
      const onZoom = delta => setZoom(z => delta === 0 ? 1 : Math.min(1.6, Math.max(0.8, Math.round((z + delta) * 100) / 100)))
      const isSelected = row => {
        if (selection === null) return false
        if (row.kind === 'task') return selection.kind === 'task' && selection.taskId === row.task.id
        if (row.kind === 'milestone') return selection.kind === 'milestone' && selection.milestoneId === row.milestone.id
        return false
      }
      return h('div', { className: 'sd-card sd-map', 'data-fill': viewMode === 'flow' ? 'true' : undefined },
        h('div', { className: 'sd-map-toolbar' },
          h(ViewSwitch, { mode: viewMode, onChange: pickView }),
          viewMode === 'tree' ? h('div', { className: 'sd-zoom' },
            h('button', { type: 'button', className: 'sd-btn', style: { padding: '0 7px' }, title: '缩小', onClick: () => { onZoom(-0.1) } }, '－'),
            h('span', { className: 'sd-sub', style: { minWidth: 36, textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }, `${Math.round(zoom * 100)}%`),
            h('button', { type: 'button', className: 'sd-btn', style: { padding: '0 6px' }, title: '放大', onClick: () => { onZoom(0.1) } }, '＋'),
            h('button', { type: 'button', className: 'sd-btn', style: { padding: '0 6px' }, title: '恢复 100%', onClick: () => { onZoom(0) } }, '1:1')) : null),
        h(MapLegend),
        viewMode === 'flow'
          ? h(RoadmapFlow, { document_, current, collapsedSet, toggleFold, selected, onSelect: setSelected })
          : h('div', { style: { position: 'relative', zoom } },
          h(MapLines, { rows }),
          rows.map((row, index) => {
            const label = row.kind === 'live'
              ? h('div', { className: 'sd-map-label sd-mono', style: { opacity: 0.85 }, title: row.current.reason ?? '' },
                h('span', { style: { color: MAP_COLORS.doing } }, '▸'),
                h('span', null, row.current.tool),
                h('span', { className: 'sd-sub', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, Array.isArray(row.current.targets) && row.current.targets.length > 0 ? row.current.targets[0].path : row.current.summary ?? ''),
                row.current.state === 'running' ? h('span', { className: 'sd-sub' }, age(row.current.at, now)) : null)
              : h(MapLabel, { row, onToggleFold: toggleFold, folded: row.folded === true })
            const isCurrent = (row.kind === 'task' && row.task?.status === 'doing') || row.kind === 'live'
            const clickable = row.kind === 'task' || row.kind === 'milestone'
            // Every milestone after the first opens its group with a divider,
            // so the eye parses sections instead of one flat list.
            const groupStart = row.kind === 'milestone' && rows.some((earlier, at) => at < index && earlier.kind === 'milestone')
            return h('div', {
              key: index,
              className: 'sd-map-row'
                + (groupStart ? ' sd-map-row-group' : '')
                + (row.kind === 'live' ? ' sd-map-row-live' : isCurrent ? ' sd-map-row-current' : '')
                + (clickable ? ' sd-map-row-clickable' : '')
                + (isSelected(row) ? ' sd-map-row-selected' : ''),
              style: { height: MAP_ROW_H, paddingLeft: MAP_COLS[row.depth] + 14 },
              onClick: clickable
                ? () => {
                  setSelected(current => {
                    const next = row.kind === 'task'
                      ? { kind: 'task', milestoneId: row.milestone.id, taskId: row.task.id }
                      : { kind: 'milestone', milestoneId: row.milestone.id }
                    // Clicking the selected node again closes the detail card.
                    const before = resolveSelection(current, document_, alerts)
                    const same = before !== null
                      && next.kind === before.kind
                      && (next.taskId === undefined || next.taskId === before.taskId)
                      && (next.milestoneId === undefined || next.milestoneId === before.milestoneId)
                    return same ? null : next
                  })
                }
                : undefined,
            }, label)
          })),
        h(NodeDetail, {
          selection,
          alerts,
          onClose: () => { setSelected(null) },
          folded: selection?.kind === 'milestone' ? collapsedSet.has(selection.milestone.id) : false,
          onToggleFold: toggleFold,
        }))
    }

    function ScopeTab({ config, viewing, onView }) {
      const document_ = config?.document ?? null
      if (document_ === null) {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          config?.sourceDoc != null ? h('div', { className: 'sd-card' },
            h('h4', { className: 'sd-h4' }, `发现计划文档 ${config.sourceDoc.path.split(/[\\/]+/).pop()}`),
            h('div', { className: 'sd-sub sd-mono' }, config.sourceDoc.path),
            h('div', { className: 'sd-sub' }, '对 Agent 说「把 roadmap.md 导入为主线」——它会把计划拆成里程碑与任务，生成配置镜像。')) : null,
          h('div', { className: 'sd-card' },
            h('h4', { className: 'sd-h4' }, '让 Agent 接入（推荐）'),
            h('div', { className: 'sd-sub' },
              '在本项目的会话里对 Agent 说一句话，它会摸底仓库、和你对齐里程碑拆分，然后写出配置：'),
            h('pre', { className: 'sd-pre sd-mono' }, '给这个项目接入主线')),
          h('div', { className: 'sd-card' },
            h('h4', { className: 'sd-h4' }, '或手动创建配置'),
            h('div', { className: 'sd-sub' }, '新建下面任一处的配置文件即可开始判定（写入后自动生效，无需重启）：'),
            h('ul', { className: 'sd-list' }, (config?.candidates ?? []).map(path => h('li', { key: path, className: 'sd-mono' }, path)))),
          h('div', { className: 'sd-card' },
            h('h4', { className: 'sd-h4' }, '最小可用配置'),
            h('pre', { className: 'sd-pre sd-mono' }, TEMPLATE)))
      }
      const milestones = Array.isArray(document_.milestones) ? document_.milestones : []
      const active = milestones.find(entry => entry.id === document_.activeMilestoneId) ?? milestones[0] ?? null
      const shown = milestones.find(entry => entry.id === viewing) ?? active
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'sd-card' },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h('span', { className: 'sd-sub' }, '当前里程碑（来自配置，只读）'),
            active !== null ? h(LevelChip, { level: 'display' }, `${active.id}${active.title === '' ? '' : ` · ${active.title}`}`) : h('span', { className: 'sd-sub' }, '未设置')),
          h('div', { className: 'sd-sub', style: { marginTop: 4 } },
            '事件归属在发生时按此盖章；下面的下拉只切换查看，不回写配置。'),
          milestones.length > 0
            ? h('div', { style: { marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' } },
              h('span', { className: 'sd-sub' }, '查看'),
              h('select', {
                className: 'sd-btn',
                value: shown?.id ?? '',
                onChange: event => { onView(event.target.value) },
              }, milestones.map(entry => h('option', { key: entry.id, value: entry.id }, `${entry.id}${entry.title === '' ? '' : ` · ${entry.title}`}`))))
            : null),
        shown === null ? null : h('div', { className: 'sd-card' },
          h('h4', { className: 'sd-h4' }, `${shown.id} 允许清单`),
          shown.allow.length === 0
            ? h('div', { className: 'sd-sub' }, '（空：本里程碑内任何写入都会被判为计划外）')
            : h('ul', { className: 'sd-list' }, shown.allow.map(entry => h('li', { key: entry, className: 'sd-mono' }, entry))),
          h('h4', { className: 'sd-h4', style: { marginTop: 10 } }, `${shown.id} 禁止清单`),
          shown.forbid.length === 0
            ? h('div', { className: 'sd-sub' }, '（空）')
            : h('ul', { className: 'sd-list' }, shown.forbid.map(entry => h('li', { key: entry, className: 'sd-mono' }, entry)))),
        (document_.rootForbid ?? []).length > 0 ? h('div', { className: 'sd-card' },
          h('h4', { className: 'sd-h4' }, '项目红线（任何里程碑都禁止）'),
          h('ul', { className: 'sd-list' }, document_.rootForbid.map(entry => h('li', { key: entry, className: 'sd-mono' }, entry)))) : null,
        shown === null ? null : h('div', { className: 'sd-card' },
          h('h4', { className: 'sd-h4' }, `${shown.id} 任务与验收`),
          shown.tasks.length === 0
            ? h('div', { className: 'sd-sub' }, '（未登记任务）')
            : shown.tasks.map(task => h('div', { key: task.id, style: { marginTop: 6 } },
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' } },
                h('span', { className: 'sd-mono', style: { fontSize: 12, fontWeight: 600 } }, task.id),
                h('span', { style: { fontSize: 12 } }, task.title)),
              task.acceptance.length === 0
                ? null
                : h('ul', { className: 'sd-list' }, task.acceptance.map((item, index) => h('li', {
                  key: `${task.id}-${index}`,
                  style: { opacity: 0.55 },
                }, item, h('span', { className: 'sd-untested' }, '未验证'))))))))
    }

/**
     * The docked footer both surfaces share: one collapsed line (判定/偏离计数)
     * that expands into the detail tabs. `open` lifts to the caller because the
     * main panel and the sidebar remember different defaults.
     */
    const DETAIL_TABS = [
      ['alerts', '告警队列', view => `告警队列 ${view?.alerts?.length ? `(${view.alerts.length})` : ''}`],
      ['events', '事件流', view => `事件流 ${view?.events?.length ? `(${view.events.length})` : ''}`],
      ['scope', '配置详情', () => '配置详情'],
    ]

    function DetailDock({ health, alerts, view, open, onToggle, tab, onTab, children }) {
      // Collapsed = one slim strip (no "次数/率" filler when everything is at
      // zero: silence is the healthy state). Expanded = the tabs open UPWARD
      // as an overlay (the body is absolutely positioned above the strip), so
      // the map never reflows when details open or close.
      const healthy = (health?.drifted ?? 0) === 0 && alerts.length === 0
      return h('div', { className: 'sd-dock' },
        h('div', { className: 'sd-dock-bar' },
          healthy
            ? h('span', { className: 'sd-sub', style: { opacity: .8 } }, '✓ 无偏离')
            : h('span', { className: 'sd-sub', style: { color: alerts.some(alert => alert.level === 'red') ? '#ef4444' : (health?.drifted ?? 0) > 0 ? '#d97706' : undefined } },
              `偏离 ${health?.drifted ?? 0} · 待处理 ${alerts.length}`),
          h('span', { className: 'sd-spacer' }),
          h('button', {
            type: 'button',
            className: 'sd-btn',
            'aria-expanded': open,
            title: open ? '收起明细' : '展开告警与事件明细',
            onClick: onToggle,
          }, open ? '明细 ⌃' : '明细 ⌄')),
        open ? h('div', { className: 'sd-dock-body' },
          Array.isArray(children) && children.every(part => part === null)
            ? h(React.Fragment, null,
              h('div', { className: 'sd-tabs', role: 'tablist' },
                DETAIL_TABS.map(([value, , label]) => h('button', {
                  key: value,
                  type: 'button',
                  role: 'tab',
                  className: 'sd-tab',
                  'data-active': String(tab === value),
                  onClick: () => { onTab(value) },
                }, typeof label === 'function' ? label(view) : label))),
              view === null ? h('div', { className: 'sd-empty' }, '正在读取…') : null)
            : children) : null)
    }

    function FootBar({ view, onResync }) {
      const [note, setNote] = React.useState('')
      const document_ = React.useMemo(() => JSON.stringify({
        exportedAt: new Date().toISOString(),
        plugin: 'dsh-mainline',
        config: view?.config === undefined || view?.config === null
          ? null
          : { path: view.config.path, status: view.config.status, loadedAt: view.config.loadedAt, error: view.config.error, activeMilestone: view.config.document?.activeMilestoneId ?? null },
        health: view?.health ?? null,
        alerts: view?.alerts ?? [],
        events: view?.events ?? [],
      }, null, 2), [view])

      const flag = message => {
        setNote(message)
        setTimeout(() => { setNote('') }, 1800)
      }

      const copy = () => {
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
        if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
          flag('当前环境不支持剪贴板，请用「下载」')
          return
        }
        clipboard.writeText(document_).then(() => { flag('已复制 JSON') }).catch(() => { flag('复制失败，请用「下载」') })
      }

      const download = () => {
        try {
          const blob = new Blob([document_], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = `mainline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
          flag('已下载')
        } catch {
          flag('下载失败')
        }
      }

      return h('div', { className: 'sd-foot' },
        h('button', { type: 'button', className: 'sd-btn', onClick: copy }, '复制 JSON'),
        h('button', { type: 'button', className: 'sd-btn', onClick: download }, '下载 JSON'),
        h('button', { type: 'button', className: 'sd-btn', onClick: onResync }, '重新同步'),
        note === '' ? null : h('span', { className: 'sd-sub' }, note))
    }

    /** A human label for one known session: title, else the project folder. */
    function labelOfSession(entry) {
      if (entry !== null && typeof entry === 'object') {
        if (typeof entry.title === 'string' && entry.title.trim() !== '') return entry.title.trim()
        if (typeof entry.cwd === 'string' && entry.cwd.trim() !== '') {
          const parts = entry.cwd.trim().split(/[\\/]+/).filter(Boolean)
          const last = parts[parts.length - 1]
          if (last !== undefined && last !== '') return last
        }
      }
      return sessionTail(entry?.id) ?? '会话'
    }

    /** The chip row that re-points the panel at another session's project. */
    function SessionRow({ sessions, active, onPick }) {
      if (!Array.isArray(sessions) || sessions.length === 0) return null
      return h('div', { className: 'sd-sessrow' },
        h('span', { className: 'sd-sesslabel' }, '项目视角'),
        h('span', { className: 'sd-chip', 'data-active': String(active === null), title: '全部会话（机器视角）', onClick: () => { onPick(null) } }, '全部'),
        sessions.map(entry => h('span', {
          key: entry.id,
          className: 'sd-chip',
          'data-active': String(active === entry.id),
          title: `${entry.title ?? ''}${entry.cwd !== null && entry.cwd !== undefined ? `\n${entry.cwd}` : ''}`,
          onClick: () => { onPick(entry.id) },
        }, labelOfSession(entry))))
    }

    /** The goal entry of one session, when that session has a `/goal`. */
    function goalOfSession(sessions, sessionId) {
      if (!Array.isArray(sessions) || sessionId === null || sessionId === undefined) return null
      const entry = sessions.find(candidate => candidate !== null && typeof candidate === 'object' && candidate.id === sessionId)
      const goal = entry?.goal
      if (goal === null || goal === undefined || typeof goal !== 'object') return null
      const objective = typeof goal.objective === 'string' ? goal.objective.trim() : ''
      if (objective === '') return null
      return { objective, status: typeof goal.status === 'string' ? goal.status : null }
    }

    /** Goal status chip text; `active` is the default and stays unlabeled. */
    const GOAL_STATUS_TEXT = { active: null, complete: '已完成', blocked: '受阻', paused: '已暂停' }

    /** One line under the head: the session's `/goal`, display only. */
    function GoalLine({ goal }) {
      if (goal === null) return null
      const statusText = goal.status !== null ? GOAL_STATUS_TEXT[goal.status] ?? goal.status : null
      return h('div', { className: 'sd-sessrow' },
        h('span', { className: 'sd-sesslabel' }, '🎯 目标'),
        h('span', {
          className: 'sd-chip',
          title: `${goal.objective}${statusText !== null ? `\n状态：${statusText}` : ''}`,
          style: { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' },
        }, goal.objective),
        statusText !== null ? h('span', { className: 'sd-chip' }, statusText) : null)
    }

    function ScopeDriftPanel() {
      const [tab, setTab] = React.useState('alerts')
      const [viewing, setViewing] = React.useState(null)
      const [resync, setResync] = React.useState(0)
      const [bottomOpen, setBottomOpen] = React.useState(false)
      // The main panel is shell-global (it is not re-mounted per session), so
      // the project view is a manual choice here; null = machine-wide.
      const [sessionId, setSessionId] = React.useState(null)
      const { status, error, view } = useObserved(resync, sessionId)
      const running = view?.current?.state === 'running'
      const now = useNow(running === true)

      const config = view?.config ?? null
      const document_ = config?.document ?? null
      const activeTitle = (() => {
        if (document_ === null) return null
        const active = document_.milestones?.find(entry => entry.id === document_.activeMilestoneId)
        return active === null || active === undefined ? document_.activeMilestoneId : `${active.id}${active.title === '' ? '' : ` · ${active.title}`}`
      })()

      const health = view?.health ?? null
      const events = view?.events ?? []
      const alerts = view?.alerts ?? []
      // Goal of the session this panel is currently pointed at. In the
      // machine-wide view (no session picked) the newest session's goal is
      // shown, since that is whose actions fill the feed.
      const goal = (() => {
        const list = view?.sessions ?? []
        if (sessionId !== null) return goalOfSession(list, sessionId)
        const newest = list[0]
        return newest === undefined ? null : goalOfSession(list, newest.id)
      })()

      const banner = config !== null && config.status !== 'ok' && config.error !== null
        ? h('div', { className: 'sd-banner' },
          h('h4', null, config.status === 'missing' ? '未找到配置文件' : '配置解析失败（判定仍按上一次成功的配置）'),
          h('div', { className: 'sd-sub sd-mono' }, config.path),
          config.error.line !== undefined ? h('div', { className: 'sd-sub' }, `第 ${config.error.line} 行，第 ${config.error.column} 列`) : null,
          h('pre', null, config.error.message ?? ''),
          config.error.source !== undefined ? h('pre', null, config.error.source) : null,
          config.status === 'missing' ? h('div', { className: 'sd-sub', style: { marginTop: 6 } }, '在「范围与验收」页可以看到候选路径与最小模板。') : null)
        : null
      // A project that plans in prose but has no mirror yet: offer the
      // one-sentence import instead of a cold "missing" wall.
      const sourceDocBanner = config !== null && config.status === 'missing' && config.sourceDoc !== null && config.sourceDoc !== undefined
        ? h('div', { className: 'sd-banner' },
          h('h4', null, '发现计划文档 roadmap.md'),
          h('div', { className: 'sd-sub sd-mono' }, config.sourceDoc.path),
          h('div', { className: 'sd-sub' }, '对 Agent 说「把 roadmap.md 导入为主线」——它会读这份计划，拆成里程碑与任务，生成 .dsh/mainline.json。文档仍是纲领，配置是面板的镜像。'))
        : null

      return h('div', { className: 'sd-root', 'data-dsh-plugin': 'mainline' },
        h('div', { className: 'sd-head' },
          h('span', { className: 'sd-title' }, '主线'),
          document_?.project ? h('span', { className: 'sd-chip' }, document_.project) : null,
          activeTitle !== null ? h('span', { className: 'sd-chip' }, activeTitle) : null,
          h('span', { className: 'sd-spacer' }),
          config !== null && config.status === 'ok'
            ? h('span', { className: 'sd-sub' }, `配置 ${clock(config.loadedAt)} 加载`)
            : null,
          h('span', { className: 'sd-chip', title: status },
            h('span', { className: 'sd-dot', 'data-live': status === 'live' ? 'true' : 'false' }),
            status === 'live' ? '实时' : status === 'reconnecting' ? '重连中' : status === 'error' ? '未连接' : '连接中…'),
          h('button', {
            type: 'button',
            className: 'sd-btn',
            title: '重新拉取数据与实时流（不重载页面）。载入插件新代码需重启桌面端。',
            onClick: makeResyncRefresher(setResync),
          }, '刷新')),
        h('div', { className: 'sd-body' },
          error !== null ? h('div', { className: 'sd-banner' },
            h('h4', null, 'Host 接口不可用'),
            h('div', { className: 'sd-sub' }, error),
            h('div', { className: 'sd-sub', style: { marginTop: 4 } }, '确认 主线（dsh-mainline）的 Host 半已加载（插件列表里启用它），然后刷新页面。')) : null,
          h(SessionRow, { sessions: view?.sessions ?? [], active: sessionId, onPick: setSessionId }),
          h(GoalLine, { goal }),
          sourceDocBanner,
          banner,
          h(RoadmapMap, { document_: enrichRoadmap(document_), alerts, current: view?.current ?? null, now })),
        h(DetailDock, {
          health,
          alerts,
          view,
          open: bottomOpen,
          onToggle: () => { setBottomOpen(open => !open) },
          tab,
          onTab: setTab,
        }, bottomOpen ? h(React.Fragment, null,
          tab === 'events'
            ? (events.length === 0
              ? h('div', { className: 'sd-card' }, h('div', { className: 'sd-empty' }, view === null ? '正在读取…' : '还没有动作记录'))
              : h('div', { className: 'sd-card' }, events.map(event => h(EventRow, { key: event.seq, event }))))
            : null,
          tab === 'alerts'
            ? (alerts.length === 0
              ? h('div', { className: 'sd-card' }, h('div', { className: 'sd-empty' }, '告警队列是空的——当前没有越界或计划外的写入。'))
              : h('div', { className: 'sd-card' }, alerts.map(alert => h(AlertRow, { key: alert.key, alert }))))
            : null,
          tab === 'scope' ? h(ScopeTab, { config, viewing, onView: setViewing }) : null,
          h(FootBar, { view, onResync: () => { setResync(current => current + 1) } })) : null))
    }

    /** The sidebar row glyph; the shell owns the button, label and geometry. */
    function ScopeDriftPanelIcon({ size, active }) {
      const stroke = active === true ? 'currentColor' : 'currentColor'
      return h('svg', {
        'data-dsh-panel-entry': PANEL_ID,
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke,
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      h('circle', { cx: 8, cy: 8, r: 5.6 }),
      h('circle', { cx: 8, cy: 8, r: 1.4, fill: 'currentColor', stroke: 'none' }),
      h('path', { d: 'M8 1.2v1.9M8 12.9v1.9M1.2 8h1.9M12.9 8h1.9' }),
      h('path', { d: 'M10.6 5.4 8.9 8.9 5.4 10.6 7.1 7.1z' }))
    }

    /** The main-slot page. The panel root is already the flex container. */
    function ScopeDriftPage() {
      return h(ScopeDriftPanel, null)
    }

    /**
     * Register the sidebar row and the center-column page.
     *
     * Both go through `ctx.slots.inject`, which fires only when the owning
     * shell entry declares the seat — so a shell that cannot serve these seats
     * simply leaves the dashboard absent instead of failing boot.
     */
    function registerPanel(ctx) {
      const slots = ctx.slots
      if (slots === undefined || typeof slots.inject !== 'function') {
        throw new Error('slots service unavailable')
      }
      const disposers = []
      disposers.push(slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: PANEL_ORDER,
        label: () => '主线',
      }, ScopeDriftPanelIcon)))
      disposers.push(slots.inject('main', () => slots.register({
        name: 'main',
        key: PANEL_ID,
      }, ScopeDriftPage)))
      return () => {
        for (const dispose of disposers.splice(0)) dispose()
      }
    }

    /** The short tail of a session id — what fits in a chip. */
    function sessionTail(sessionId) {
      return typeof sessionId === 'string' && sessionId.length > 8 ? sessionId.slice(-8) : sessionId
    }

    /**
     * Which session a pane body is being rendered for.
     *
     * The native pane dispatches session-scoped bodies with the owning
     * session's id, so switching sessions hands this component a different id
     * and the whole feed re-points at that session's project. A runtime that
     * does not pass it simply gets the machine-wide view.
     */
    function sessionIdOfProps(props) {
      if (props === null || typeof props !== 'object') return null
      if (typeof props.sessionId === 'string' && props.sessionId !== '') return props.sessionId
      if (typeof props.sessionId === 'function') return null
      const session = props.session
      if (typeof session === 'string' && session !== '') return session
      if (session !== null && typeof session === 'object' && typeof session.id === 'string' && session.id !== '') return session.id
      return null
    }

    /**
     * The narrow right-sidebar variant: same feed, alerts-first, stacked for a
     * ~300px column. The native pane renders it per session and passes the
     * owning `sessionId` — the panel follows the session the user is looking
     * at, so switching sessions switches the project's roadmap with it.
     */
    function capabilityStatus(row, activity = {}) {
      const skill = row.kind === 'skill'
      if (row.pending > 0) return { text: skill ? '正在加载' : '等待结果', tone: 'busy', pulse: activity.turnRunning === true }
      if (skill && activity.currentTurn != null && row.loadedTurn === activity.currentTurn) {
        return { text: activity.turnRunning ? '本轮已加载' : '本轮用过', tone: 'active', pulse: activity.turnRunning === true }
      }
      if (skill && ['succeeded', 'user-loaded'].includes(row.lastStatus)) {
        return { text: row.loadedTurn == null ? '已加载 · 轮次未知' : '此前加载', tone: 'idle', pulse: false }
      }
      const states = {
        succeeded: [skill ? '已加载' : '调用成功', 'quiet'],
        'user-loaded': ['已加载', 'quiet'],
        failed: [skill ? '最近加载失败' : '最近调用失败', 'attention'],
        interrupted: [skill ? '加载已中断' : '调用已中断', 'attention'],
        notDispatched: [skill ? '未能加载' : '未能执行', 'attention'],
        unverified: ['结果待确认', 'attention'],
      }
      const [text, tone] = states[row.lastStatus] ?? ['状态待确认', 'quiet']
      return { text, tone }
    }

    function CapabilityItem({ row, activity }) {
      const skill = row.kind === 'skill'
      const status = capabilityStatus(row, activity)
      const loaded = (row.succeeded ?? 0) + (row.userLoads ?? 0)
      const date = Number.isFinite(row.lastAt) ? new Date(row.lastAt) : null
      const validDate = date !== null && Number.isFinite(date.getTime())
      const title = !skill && row.serverLabel ? row.name.slice(`mcp__${row.serverLabel}__`.length) : row.name
      const explanation = {
        failed: skill ? '最近一次读取技能说明时出错，不代表任务执行失败。' : '最近一次工具调用返回错误，不代表 Server 已断线。',
        interrupted: '调用在完成前中断，不能判定为成功。',
        notDispatched: '调用没有实际派发，可能是工具不可用或提前取消。',
        unverified: '返回内容不足以确认结果，不直接判为失败。',
      }[row.lastStatus]
      return h('li', { className: 'sd-cap-item', 'data-tone': status.tone },
        h('div', { className: 'sd-cap-item-head' },
          h('strong', { className: 'sd-cap-name' }, title),
          h('span', { className: 'sd-cap-status', 'data-tone': status.tone },
            h('span', { className: 'sd-cap-signal', 'data-pulse': status.pulse ? 'true' : undefined, 'aria-hidden': 'true' }), status.text)),
        h('p', { className: 'sd-cap-description' }, skill
          ? (row.description || '这条历史记录暂无用途说明。')
          : (row.serverLabel ? `${row.serverLabel} · Server 名称由工具标识推断` : 'Server 归属暂未确认')),
        explanation && row.pending === 0 ? h('p', { className: 'sd-cap-notice' }, explanation,
          skill && loaded > 0 ? ` 此前成功加载 ${loaded} 次。` : '') : null,
        skill ? h('div', { className: 'sd-cap-metrics' },
          h('span', { className: 'sd-cap-token', title: '最近一次成功加载内容的 token 粗估，不是计费或模型运行消耗' },
            h('strong', null, Number.isFinite(row.latestLoadTokens) ? `≈${row.latestLoadTokens.toLocaleString()}` : '—'),
            h('span', { className: 'sd-cap-token-label' }, 'tokens · 单次估算')),
          h('span', null, `加载 ${loaded} 次`)) : null,
        h('details', { className: 'sd-cap-details' },
          h('summary', null,
            h('span', null, skill ? (loaded > 0 ? `已加载 ${loaded} 次` : '加载记录') : `调用 ${row.attempts} 次`),
            validDate ? h('time', { dateTime: date.toISOString(), title: date.toLocaleString() }, date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : null,
            h('span', { className: 'sd-cap-more' }, '详情')),
          h('div', { className: 'sd-cap-detail-body' },
            row.description ? h('p', null, row.description) : null,
            skill ? h('p', null, `已统计加载文本累计约 ${Number.isFinite(row.totalLoadTokens) ? row.totalLoadTokens.toLocaleString() : '—'} tokens。重复加载重复计入；不代表当前上下文占用或实际计费。`) : null,
            skill && row.unknownLoads > 0 ? h('p', null, `${row.unknownLoads} 次加载无法完整估算，未计入累计值。${row.latestLoadTokenStatus === 'truncated' ? '最近加载文本超过统计上限。' : ''}`) : null,
            skill ? h('p', null, '估算口径：英文等 ASCII 字符约 4 字符 / token，非 ASCII 按码点粗估；包含加载返回的说明及包装文本，不含后续工具调用、参考文件或模型输出。无可统计文本或超过统计上限时显示 —，不是 0。') : null,
            h('p', null, `请求 ${row.attempts} 次 · ${skill ? '加载' : '调用'}成功 ${row.succeeded} 次${row.userLoads ? ` · 用户直接加载 ${row.userLoads} 次` : ''}`),
            row.failed > 0 ? h('p', null, `${skill ? '加载' : '调用'}失败 ${row.failed} 次（本会话累计）`) : null,
            row.interrupted > 0 ? h('p', null, `中断 ${row.interrupted} 次`) : null,
            row.notDispatched > 0 ? h('p', null, `未执行 ${row.notDispatched} 次`) : null,
            row.unverified > 0 ? h('p', null, `结果未确认 ${row.unverified} 次`) : null,
            validDate ? h('p', null, `最近记录：${date.toLocaleString()}`) : null,
            !skill ? h('p', { className: 'sd-mono' }, row.name) : null,
            row.lastErrorCode ? h('p', null, `错误类别：${row.lastErrorCode}`) : null)))
    }

    /** Native projection hook supplied by the session-scoped sidebar slot. */
    function SessionCapabilities(props) {
      const state = props.useProjection('mainline.capabilities')
      const [filter, setFilter] = React.useState('all')
      if (state === undefined || state === null) return h('div', { className: 'sd-cap-empty' },
        h('strong', null, '正在等待会话记录'),
        h('p', null, '暂时还拿不到数据，不代表没有使用技能。'))
      const rows = Array.isArray(state.rows) ? state.rows : []
      const needsAttention = row => ['failed', 'interrupted', 'notDispatched', 'unverified'].includes(row.lastStatus)
      const attention = rows.filter(needsAttention).length
      const skills = rows.filter(row => row.kind === 'skill')
      const thisTurnSkills = skills.filter(row => state.currentTurn != null && row.loadedTurn === state.currentTurn).length
      const knownTokens = skills.filter(row => Number.isFinite(row.totalLoadTokens))
      const tokenTotal = knownTokens.reduce((sum, row) => Math.min(Number.MAX_SAFE_INTEGER, sum + row.totalLoadTokens), 0)
      const group = (kind, title, subtitle) => {
        const all = rows.filter(row => row.kind === kind)
        const priority = row => row.pending > 0 ? 2 : capabilityStatus(row, state).tone === 'active' ? 1 : 0
        const items = all.filter(row => filter !== 'attention' || needsAttention(row))
          .sort((a, b) => priority(b) - priority(a) || (b.lastSeq ?? 0) - (a.lastSeq ?? 0))
        if (items.length === 0 && filter === 'attention') return null
        return h('section', { className: 'sd-cap-section', 'aria-label': title },
          h('div', { className: 'sd-cap-section-head' }, h('h3', null, title), h('span', null, all.length)),
          h('p', { className: 'sd-cap-caption' }, subtitle),
          items.length > 0 ? h('ul', { className: 'sd-cap-list' }, items.map(row => h(CapabilityItem, { key: `${row.kind}:${row.name}`, row, activity: state })))
            : h('p', { className: 'sd-cap-empty' }, kind === 'skill' ? '还没有技能加载记录。' : '还没有 MCP 调用记录。'))
      }
      return h('div', { className: 'sd-cap-page' },
        h('style', null, CSS_TEXT),
        h('header', { className: 'sd-cap-header' }, h('h2', null, '本会话使用记录'),
          h('p', null, '技能参与、加载体积与最近状态')),
        h('div', { className: 'sd-cap-overview' },
          h('div', null, h('strong', null, thisTurnSkills), h('span', null, state.turnRunning ? '本轮已加载技能' : '最近一轮加载技能')),
          h('div', { title: '本会话已记录技能加载文本的累计估算；不是计费 token，缺失记录不计入' },
            h('strong', null, knownTokens.length ? `≈${tokenTotal >= 1000 ? `${(tokenTotal / 1000).toFixed(1)}k` : tokenTotal}` : '—'),
            h('span', null, '累计加载 tokens · 估算'))),
        h('div', { className: 'sd-cap-filters', role: 'group', 'aria-label': '筛选能力记录' },
          [['all', `全部 ${rows.length}`], ['attention', `需关注 ${attention}`]].map(([value, text]) => h('button', {
            key: value, type: 'button', 'aria-pressed': filter === value, onClick: () => setFilter(value),
          }, text))),
        filter === 'attention' && attention === 0 ? h('p', { className: 'sd-cap-empty' }, '最近记录中没有需要关注的异常。') : null,
        group('skill', '技能 Skills', '绿点：本轮加载 · 灰点：此前加载'),
        group('mcp-tool', '外部工具 MCP', '按工具展示，不代表服务连接状态。'),
        h('details', { className: 'sd-cap-help' }, h('summary', null, '这些状态是什么意思？'),
          h('p', null, '绿色呼吸点：本轮成功加载了技能说明，且本轮尚未结束；不代表能检测模型此刻是否遵循。结束后常亮，新一轮未重新加载则变灰。蓝点为等待加载结果，琥珀点为异常。灰色仅表示缺少本轮加载证据，不表示确定未参与。'),
          h('p', null, '加载失败：读取说明失败。调用失败：工具返回错误。统计为本会话累计，徽标表示最近结果。'),
          h('p', null, '仅显示可识别的原生调用；封装调用可能遗漏。不是安装清单，也不检测 MCP 在线状态。'),
          state.dropped > 0 ? h('p', null, `已省略 ${state.dropped} 条较早建立的记录。`) : null))
    }

    function ScopeDriftSide(tabProps) {
      const sessionId = sessionIdOfProps(tabProps)
      const [tab, setTab] = React.useState('alerts')
      const [rightTab, setRightTab] = React.useState('roadmap')
      const [resync, setResync] = React.useState(0)
      const [bottomOpen, setBottomOpen] = React.useState(false)
      const { status, error, view } = useObserved(resync, sessionId)
      const running = view?.current?.state === 'running'
      const now = useNow(running === true)
      const config = view?.config ?? null
      const document_ = config?.document ?? null
      const events = view?.events ?? []
      const alerts = view?.alerts ?? []
      const health = view?.health ?? null
      const goal = goalOfSession(view?.sessions ?? [], sessionId)
      const banner = config !== null && config.status !== 'ok' && config.error !== null
        ? h('div', { className: 'sd-banner' },
          h('h4', null, config.status === 'missing' ? '未找到配置文件' : '配置解析失败'),
          h('div', { className: 'sd-sub sd-mono' }, config.path),
          h('pre', null, config.error.message ?? ''))
        : null
      const sourceDocBanner = config !== null && config.status === 'missing' && config.sourceDoc !== null && config.sourceDoc !== undefined
        ? h('div', { className: 'sd-banner' },
          h('h4', null, '发现计划文档 roadmap.md'),
          h('div', { className: 'sd-sub' }, '对 Agent 说「把 roadmap.md 导入为主线」即可生成面板配置。'))
        : null
      return h('div', { className: 'sd-root sd-side' },
        h('div', { className: 'sd-head' },
          h('span', { className: 'sd-title' }, '主线'),
          document_?.project ? h('span', { className: 'sd-chip' }, document_.project) : null,
          h('span', { className: 'sd-spacer' }),
          sessionId !== null ? h('span', { className: 'sd-chip', title: sessionId }, sessionTail(sessionId)) : null,
          h('span', { className: 'sd-chip', title: status },
            h('span', { className: 'sd-dot', 'data-live': status === 'live' ? 'true' : 'false' }),
            status === 'live' ? '实时' : status === 'reconnecting' ? '重连' : '…'),
          h('button', {
            type: 'button',
            className: 'sd-btn',
            title: '重新拉取数据与实时流（不重载页面）。载入插件新代码需重启桌面端。',
            onClick: makeResyncRefresher(setResync),
          }, '刷新')),
        h('div', { className: 'sd-side-tabs', role: 'group', 'aria-label': '主线侧栏视图' },
          [['roadmap', '路线图'], ['capabilities', '会话能力']].map(([value, label]) => h('button', {
            key: value, type: 'button', 'aria-pressed': rightTab === value,
            className: rightTab === value ? 'sd-side-tab sd-side-tab-active' : 'sd-side-tab',
            onClick: () => { setRightTab(value) },
          }, label))),
        h('div', { className: 'sd-scroll' },
          rightTab === 'capabilities' ? h(SessionCapabilities, tabProps) : h(React.Fragment, null,
            error !== null ? h('div', { className: 'sd-banner' }, h('h4', null, 'Host 接口不可用'), h('div', { className: 'sd-sub' }, error)) : null,
            h(GoalLine, { goal }),
            sourceDocBanner,
            banner,
            h(RoadmapMap, { document_: enrichRoadmap(document_), alerts, current: view?.current ?? null, now }))),
        rightTab === 'roadmap' ? h(DetailDock, {
          health,
          alerts,
          view,
          open: bottomOpen,
          onToggle: () => { setBottomOpen(open => !open) },
          tab,
          onTab: setTab,
        }, bottomOpen ? h(React.Fragment, null,
          tab === 'alerts'
            ? (alerts.length === 0
              ? h('div', { className: 'sd-card' }, h('div', { className: 'sd-empty' }, '暂无越界或计划外写入'))
              : h('div', { className: 'sd-card' }, alerts.map(alert => h(AlertRow, { key: alert.key, alert }))))
            : null,
          h(FootBar, { view, onResync: () => { setResync(current => current + 1) } })) : null) : null)
    }

    /**
     * Register the dashboard as a native right-sidebar tab type.
     *
     * The two-side contract is the same one flowglass uses: `sidebarRightTabs.
     * register` declares the page type (its `guide` entry is the launcher row)
     * and the SAME id declares the body in the keyed `sidebar.right.pane.tab`
     * seat. Both services are waited on with `ctx.inject` because the tab
     * registry can appear after the slot declaration — a declaration-triggered
     * registration would read it as missing and never retry.
     *
     * @returns the injection disposer, or null on a runtime without inject.
     */
    function registerRightSidebar(ctx) {
      if (typeof ctx.inject !== 'function') return null
      return ctx.inject(['sidebarRightTabs', 'sidebarRight'], (nativeCtx) => {
        const tabs = nativeCtx.get('sidebarRightTabs')
        if (tabs === undefined || tabs === null || typeof tabs.register !== 'function') return
        const controller = nativeCtx.get('sidebarRight')
        const slots = nativeCtx.get('slots')
        const disposeType = tabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: () => '主线',
          guide: [{
            order: 45,
            title: () => '主线',
            description: () => 'roadmap 进度与偏离主线判定（只读）',
            icon: ScopeDriftPanelIcon,
          }],
        })
        // The body slot may be DECLARED later than this registration (the
        // sidebar-right entry loads on its own schedule). Track readiness: a
        // tab opened before its body exists is an empty white pane forever.
        let bodyReady = false
        let warned = false
        const tryOpen = () => {
          if (bodyReady !== true) return
          try {
            if (controller !== undefined && controller !== null && typeof controller.openTab === 'function') controller.openTab(TAB_KIND)
          } catch (error) {
            // "no session surface is mounted" is the NORMAL early state (the
            // sidebar-right controller exists before any session does), so it
            // must not read as a plugin failure or spam the console on every
            // retry; anything else is a real registration problem — log once.
            const message = error instanceof Error ? error.message : String(error)
            if (!message.includes('no session surface') && warned !== true) {
              warned = true
              console.error('[dsh-mainline] openTab failed:', error)
            }
          }
        }
        const disposeBody = nativeCtx.effect(() => slots.inject('sidebar.right.pane.tab', () => {
          // Fires once per session context: the pane is session-scoped, so a
          // session switch re-runs this. Re-ask for visibility in the NEW
          // session (openTab on an open tab is a focus no-op) — without this
          // the roadmap would silently disappear after every switch.
          bodyReady = true
          const timer = setTimeout(tryOpen, 350)
          const disposeRegistration = slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
          }, tabProps => h(ScopeDriftSide, tabProps))
          return () => {
            clearTimeout(timer)
            disposeRegistration()
          }
        }))
        // 打开即展开：这条注册本身就是“我要在右侧边栏看到它”，openTab 对已开的
        // 同类 tab 是聚焦语义，重复调用无害。
        //
        // 两个前置：① 右侧栏 tab 是会话级的，apply 发生在启动早期时常常还没有
        // 任何会话，openTab 会静默无效；② body 槽位可能晚于类型注册才就绪。
        // 所以重试 + 双闸门：body 就绪前不开。
        const openTimers = [1200, 3000, 7000, 14000, 22000].map(delay => setTimeout(tryOpen, delay))
        nativeCtx.effect(() => () => {
          openTimers.forEach(timer => { clearTimeout(timer) })
          try {
            disposeBody()
          } catch {
            /* already gone */
          }
          try {
            disposeType()
          } catch {
            /* already gone */
          }
        })
      })
    }

    exports.inject = ['slots']

    exports.apply = function apply(ctx) {
      ctx.effect(() => {
        ensureStyle()
        let disposePanel = null
        let disposeSide = null
        try {
          disposePanel = registerPanel(ctx)
        } catch (error) {
          // A shell that cannot serve the seats degrades the dashboard, never
          // the GUI: an external plugin's apply must not throw.
          console.error('[dsh-mainline] panel registration failed:', error)
        }
        try {
          disposeSide = registerRightSidebar(ctx)
        } catch (error) {
          // No native right sidebar (or an older host): the center panel and
          // the sidebar row keep working without it.
          console.error('[dsh-mainline] right-sidebar registration failed:', error)
        }
        return () => {
          disposePanel?.()
          disposeSide?.()
          const element = document.getElementById(STYLE_ID)
          if (element !== null) element.remove()
        }
      }, 'mainline: panel surfaces')
    }

    return module.exports
  },
})
