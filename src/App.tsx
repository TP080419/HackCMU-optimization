import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import {
  BUILD_ORDER,
  DEFINITIONS,
  DEMO_BASELINE_PROGRAM,
  DEMO_SHORT_PROGRAM,
  ITEM_LABELS,
  RAW_PER_CORE,
  STEP_SECONDS,
} from './game/config'
import { resetDrone } from './game/drone'
import { clearSave, loadGame, readBestResults, recordBest, saveGame, SAVE_KEY } from './game/save'
import {
  analyze,
  applyDroneSource,
  baselineComparison,
  createScenario,
  demolishEntity,
  entityAt,
  getMachineStatus,
  getPowerCapacity,
  getPowerDemand,
  getPowerMultiplier,
  keepOptimizing,
  markBaseline,
  placeEntity,
  placementProblem,
  rotateEntity,
  stepSimulation,
} from './game/simulation'
import type { BuildableKind, GameState, Orientation, Point, ScenarioMode } from './game/types'
import { WorldCanvas } from './ui/WorldCanvas'

type Screen = 'menu' | 'game'
type DockTab = 'inspector' | 'drone' | 'analyzer'

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function orientationName(orientation: Orientation): string {
  return ['East', 'South', 'West', 'North'][orientation]
}

function entityName(kind: string): string {
  return kind === 'uplink' ? 'Core Uplink' : DEFINITIONS[kind as BuildableKind]?.name ?? kind
}

interface BoundaryState { error: Error | null }
export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null }
  static getDerivedStateFromError(error: Error): BoundaryState { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('XenoFlow UI error', error, info) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="fatal-screen">
        <p className="eyebrow">SYSTEM RECOVERY</p>
        <h1>The command console encountered an error.</h1>
        <p>Your latest good save is still in this browser. Reload to recover it in paused mode.</p>
        <pre>{this.state.error.message}</pre>
        <button className="primary" onClick={() => window.location.reload()}>Reload XenoFlow</button>
      </main>
    )
  }
}

function TopHud({ state, mutate, onMenu }: { state: GameState; mutate: (fn: (state: GameState) => void, save?: boolean) => void; onMenu: () => void }) {
  const analysis = analyze(state)
  const demand = getPowerDemand(state)
  const capacity = getPowerCapacity(state)
  const throttle = getPowerMultiplier(state)
  return (
    <header className="top-hud">
      <button className="brand-button" onClick={onMenu} aria-label="Save and return to main menu">
        <span className="brand-mark">X</span><span><b>XENOFLOW</b><small>{state.scenario === 'demo' ? 'INSTANT DEMO' : 'NEW FACTORY'}</small></span>
      </button>
      <div className="hud-stat"><span>Credits</span><strong>₡ {state.credits}</strong></div>
      <div className={`hud-stat ${demand > capacity ? 'danger' : ''}`}><span>Power</span><strong>{demand} / {capacity}</strong><small>{throttle < 1 ? `${Math.round(throttle * 100)}% throttle` : 'stable'}</small></div>
      <div className="hud-stat core-stat"><span>Cores delivered</span><strong>{state.stats.delivered} <i>/ 6</i></strong></div>
      <div className="hud-stat"><span>Sim time</span><strong>{formatTime(state.simulatedTime)}</strong></div>
      <div className="hud-stat"><span>Efficiency</span><strong>{analysis.warmingUp ? 'WARMING UP' : `${analysis.efficiency.toFixed(1)}%`}</strong></div>
      <div className="speed-controls" aria-label="Simulation speed controls">
        <button className={state.paused ? 'active' : ''} onClick={() => mutate((draft) => { draft.paused = !draft.paused })}>{state.paused ? '▶ Resume' : 'Ⅱ Pause'}</button>
        {([1, 2, 4] as const).map((speed) => <button key={speed} className={!state.paused && state.speed === speed ? 'active' : ''} onClick={() => mutate((draft) => { draft.speed = speed; draft.paused = false })}>{speed}×</button>)}
      </div>
    </header>
  )
}

function Objectives({ state, mutate, onHelp }: { state: GameState; mutate: (fn: (state: GameState) => void, save?: boolean) => void; onHelp: () => void }) {
  const objectives = [
    { label: 'Place Crop Plots', done: state.entities.some((entity) => entity.kind === 'crop') },
    { label: 'Harvest Xenograin', done: state.stats.harvested > 0 },
    { label: 'Produce Water + Crystite', done: state.stats.producedBy.water > 0 && state.stats.producedBy.crystite > 0 },
    { label: 'Produce Gel + Biofiber', done: state.stats.producedBy.gel > 0 && state.stats.producedBy.biofiber > 0 },
    { label: 'Assemble a Core', done: state.stats.producedBy.core > 0 },
    { label: 'Deliver 6 Cores', done: state.stats.delivered >= 6 },
  ]
  const complete = objectives.filter((objective) => objective.done).length
  return (
    <section className="objective-strip" aria-label="Mission objectives">
      <button className="collapse-button" onClick={() => mutate((draft) => { draft.settings.objectivesCollapsed = !draft.settings.objectivesCollapsed })} aria-expanded={!state.settings.objectivesCollapsed}>
        <span className="objective-kicker">MISSION // TERRAFORM</span>
        <strong>{complete}/{objectives.length} objectives</strong>
        <span>{state.settings.objectivesCollapsed ? '▾' : '▴'}</span>
      </button>
      {!state.settings.objectivesCollapsed && <div className="objective-items">
        {objectives.map((objective) => <span key={objective.label} className={objective.done ? 'done' : ''}><i>{objective.done ? '✓' : '○'}</i>{objective.label}</span>)}
      </div>}
      <button className="text-button" onClick={onHelp}>Help & recipes</button>
    </section>
  )
}

function InspectorPanel({ state, selectedId, mutate, setSelected, setTool }: {
  state: GameState
  selectedId: string | null
  mutate: (fn: (state: GameState) => void, save?: boolean) => void
  setSelected(id: string | null): void
  setTool(kind: 'demolish'): void
}) {
  const selected = state.entities.find((entity) => entity.id === selectedId)
  if (!selected) return (
    <div className="empty-panel">
      <div className="radar-icon">⌖</div>
      <h3>No tile selected</h3>
      <p>Click a machine, belt, or terrain tile to inspect it. Output ports are marked by arrows.</p>
      <div className="legend"><span><i className="dot working"/> working</span><span><i className="dot starved"/> starved</span><span><i className="dot blocked"/> blocked</span></div>
    </div>
  )
  const status = getMachineStatus(state, selected)
  const definition = selected.kind === 'uplink' ? null : DEFINITIONS[selected.kind]
  const inputEntries = Object.entries(selected.input).filter(([, count]) => (count ?? 0) > 0)
  return (
    <div className="panel-stack">
      <div className="inspector-heading"><div className="machine-glyph">{definition?.abbreviation ?? 'UP'}</div><div><p className="eyebrow">ENTITY {selected.id.toUpperCase()}</p><h2>{entityName(selected.kind)}</h2></div></div>
      <div className={`status-chip ${status.status.toLowerCase().replace(' ', '-')}`}><i />{status.status}{status.missing ? ` — missing ${ITEM_LABELS[status.missing]}` : ''}</div>
      <dl className="data-grid">
        <div><dt>Coordinates</dt><dd>{selected.x}, {selected.y}</dd></div>
        <div><dt>Facing</dt><dd>{orientationName(selected.orientation)}</dd></div>
        <div><dt>Power</dt><dd>{definition?.power ?? 0}</dd></div>
        <div><dt>Progress</dt><dd>{selected.progress.toFixed(1)}s</dd></div>
      </dl>
      <section className="buffer-box"><h3>Buffers</h3>{inputEntries.length === 0 && !selected.output && selected.items.length === 0 ? <p className="muted">Empty</p> : <>
        {inputEntries.map(([item, count]) => <p key={item}><span className={`item-dot ${item}`} />{ITEM_LABELS[item as keyof typeof ITEM_LABELS]} <b>× {count}</b></p>)}
        {selected.items.length > 0 && <p>Stored items <b>× {selected.items.length}/20</b></p>}
        {selected.output && <p><span className={`item-dot ${selected.output}`} />Output: {ITEM_LABELS[selected.output]}</p>}
        {selected.batch && <p>Reserved batch in progress</p>}
      </>}</section>
      {definition && <p className="description">{definition.description}</p>}
      {selected.kind !== 'uplink' && <div className="button-row">
        <button onClick={() => mutate((draft) => { rotateEntity(draft, selected.id) })}>Rotate (R)</button>
        <button className="danger-button" onClick={() => { setTool('demolish'); setSelected(null) }}>Demolish tool</button>
      </div>}
    </div>
  )
}

function DronePanel({ state, source, setSource, mutate, notify }: {
  state: GameState
  source: string
  setSource(value: string): void
  mutate: (fn: (state: GameState) => void, save?: boolean) => void
  notify(message: string, error?: boolean): void
}) {
  const apply = () => {
    const result = applyDroneSource(state, source)
    if (!result.ok) notify(result.error, true)
    else {
      mutate(() => undefined)
      notify('Program validated and installed.')
    }
  }
  return (
    <div className="panel-stack drone-panel">
      <div className="drone-readout">
        <div><span>Position</span><strong>{state.drone.x}, {state.drone.y}</strong></div>
        <div><span>Cargo</span><strong>{state.drone.cargo} / {state.drone.capacity}</strong></div>
        <div><span>Distance</span><strong>{state.drone.distance} tiles</strong></div>
      </div>
      {state.scenario === 'demo' && <div className="program-presets">
        <button onClick={() => setSource(DEMO_BASELINE_PROGRAM)}>Load baseline</button>
        <button onClick={() => setSource(DEMO_SHORT_PROGRAM)}>Load shorter route</button>
      </div>}
      <label className="code-label" htmlFor="drone-source"><span>DRONE PROGRAM</span><small>{source.split('\n').length}/200 lines</small></label>
      <textarea id="drone-source" spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)} aria-describedby="drone-command-help" />
      <div className="button-row">
        <button className="primary" onClick={apply}>Apply & Run</button>
        <button onClick={() => mutate((draft) => { draft.drone.paused = !draft.drone.paused; draft.drone.message = draft.drone.paused ? 'Drone paused by operator.' : 'Drone resumed.' })}>{state.drone.paused ? 'Resume Drone' : 'Pause Drone'}</button>
        <button onClick={() => mutate((draft) => resetDrone(draft.drone))}>Reset</button>
      </div>
      <div className={`runtime-readout ${state.drone.error ? 'error' : ''}`}>
        <span>{state.drone.currentLine ? `LINE ${state.drone.currentLine}` : 'RUNTIME'}</span>
        <code>{state.drone.currentText || state.drone.message}</code>
        {state.drone.currentText && <small>{state.drone.message}</small>}
      </div>
      <details id="drone-command-help" className="command-help">
        <summary>Command reference</summary>
        <code>MOVE_TO x y</code><p>Fly to a tile (1 tile/s).</p>
        <code>HARVEST</code><p>Harvest the Crop Plot beneath the drone.</p>
        <code>DROP x y [1–4]</code><p>Unload into an adjacent compatible input side.</p>
        <code>WAIT 0.1–60</code><p>Wait in simulated seconds.</p>
        <code>REPEAT 1–100 … END</code><p>Repeat a safe block.</p>
        <code>LOOP … END</code><p>Repeat forever. Lines beginning with # are comments.</p>
        <p className="muted">For New Factory, replace fixture coordinates with the tiles you actually build. Toggle coordinates below the map and click tiles in Inspect Coordinates mode.</p>
      </details>
    </div>
  )
}

function AnalyzerPanel({ state, mutate, setSelected, notify }: {
  state: GameState
  mutate: (fn: (state: GameState) => void, save?: boolean) => void
  setSelected(id: string | null): void
  notify(message: string, error?: boolean): void
}) {
  const analysis = analyze(state)
  const comparison = baselineComparison(state)
  const assembler = state.entities.find((entity) => entity.kind === 'coreAssembler')
  const assemblerDurations = assembler ? analysis.machineDurations[assembler.id] : undefined
  return (
    <div className="panel-stack analyzer-panel">
      <div className="efficiency-ring" style={{ '--value': `${Math.max(0, Math.min(100, analysis.efficiency)) * 3.6}deg` } as React.CSSProperties}>
        <div><strong>{analysis.warmingUp ? '—' : analysis.efficiency.toFixed(0)}</strong><span>{analysis.warmingUp ? 'WARMING UP' : 'EFFICIENCY'}</span></div>
      </div>
      <dl className="data-grid">
        <div><dt>Cores / min</dt><dd>{analysis.coreRate.toFixed(2)}</dd></div>
        <div><dt>Window</dt><dd>{analysis.elapsedWindow.toFixed(1)}s / 60s</dd></div>
        <div><dt>Drone travel</dt><dd>{Math.round(analysis.travelFraction * 100)}%</dd></div>
        <div><dt>Item retention</dt><dd>{Math.round(analysis.retention * 100)}%</dd></div>
      </dl>
      {assemblerDurations && <div className="duration-bar" title="Assembler state durations in the active window">
        {Object.entries(assemblerDurations).map(([status, seconds]) => seconds > 0 && <span key={status} className={status.toLowerCase().replace(' ', '-')} style={{ width: `${seconds / analysis.elapsedWindow * 100}%` }} />)}
      </div>}
      <section className="diagnoses"><h3>Measured bottlenecks</h3>
        {analysis.elapsedWindow < 15 ? <p className="collecting">Collecting data… {analysis.elapsedWindow.toFixed(1)}/15s minimum</p> : analysis.diagnoses.length ? analysis.diagnoses.map((diagnosis, index) => (
          <button key={`${diagnosis.text}-${index}`} onClick={() => diagnosis.entityId && setSelected(diagnosis.entityId)}><span>{index + 1}</span>{diagnosis.text}</button>
        )) : <p className="good-news">No material bottleneck in the current window.</p>}
      </section>
      {state.scenario === 'demo' && <section className="comparison-card"><p className="eyebrow">TEMPORARY ROUTE COMPARISON</p>
        {!state.baseline ? <>
          <p>After a full 60-second window, mark the current measured throughput and travel share.</p>
          <button disabled={analysis.elapsedWindow < 60} onClick={() => mutate((draft) => { if (!markBaseline(draft)) notify('Collect a full 60-second window first.', true); else notify('Baseline marked. Apply an edited route next.') })}>Mark baseline</button>
        </> : comparison.ready && comparison.before && comparison.current ? <>
          <div className="comparison-values"><span>Before<b>{comparison.before.throughput.toFixed(2)} cores/min</b><small>{Math.round(comparison.before.travelFraction * 100)}% travel</small></span><span>Current<b>{comparison.current.throughput.toFixed(2)} cores/min</b><small>{Math.round(comparison.current.travelFraction * 100)}% travel</small></span></div>
          <p className={comparison.current.throughput > comparison.before.throughput ? 'good-news' : 'muted'}>Δ {(comparison.current.throughput - comparison.before.throughput).toFixed(2)} cores/min · {Math.round((comparison.current.travelFraction - comparison.before.travelFraction) * 100)} pts travel</p>
          <button onClick={() => mutate((draft) => { draft.baseline = null })}>Clear comparison</button>
        </> : <><p className="collecting">{comparison.reason}</p><button onClick={() => mutate((draft) => { draft.baseline = null })}>Clear baseline</button></>}
      </section>}
      <details className="score-formula"><summary>Why this score?</summary><p>Efficiency = throughput × (80% + 10% power stability + 10% item retention). Throughput reaches 100% at 2 Cores/min. Retention is an item-event proxy, not physical mass balance.</p></details>
    </div>
  )
}

function Palette({ state, buildKind, demolish, selectBuild, selectDemolish, orientation }: {
  state: GameState
  buildKind: BuildableKind | null
  demolish: boolean
  selectBuild(kind: BuildableKind): void
  selectDemolish(): void
  orientation: Orientation
}) {
  return (
    <section className="palette" aria-label="Construction palette">
      <div className="palette-header"><span>BUILD // {orientationName(orientation).toUpperCase()}</span><small>Click to place · drag straight belts · R rotate · Esc cancel</small></div>
      <div className="palette-grid">
        {BUILD_ORDER.map((kind) => {
          const definition = DEFINITIONS[kind]
          const disabled = state.credits < definition.cost
          return <button key={kind} className={buildKind === kind ? 'selected' : ''} onClick={() => selectBuild(kind)} title={definition.description} aria-pressed={buildKind === kind}>
            <i style={{ background: definition.color }}>{definition.abbreviation}</i><span><b>{definition.name}</b><small>₡{definition.cost} {definition.power > 0 ? `· ⚡${definition.power}` : ''}</small></span>{disabled && <em>LOW</em>}
          </button>
        })}
        <button className={`demolish-tool ${demolish ? 'selected' : ''}`} onClick={selectDemolish} aria-pressed={demolish}><i>×</i><span><b>Demolish</b><small>80% refund</small></span></button>
      </div>
    </section>
  )
}

function HelpDialog({ onClose }: { onClose(): void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <button className="modal-close" onClick={onClose} aria-label="Close help">×</button>
    <p className="eyebrow">FIELD MANUAL // 01</p><h1 id="help-title">Turn alien soil into Terraform Cores.</h1>
    <div className="help-grid">
      <div><h2>The chain</h2><p>Build on the marked terrain. Water and Crystite travel on belts. Your drone harvests Xenograin and drops it into the refinery and mill. Route their outputs into the Core Assembler, then belt Cores into the protected Uplink.</p><div className="recipe-list"><p><b>Gel Refinery</b><span>2 Xenograin + 1 Water → 1 Gel · 6s</span></p><p><b>Fiber Mill</b><span>1 Xenograin + 2 Crystite → 1 Biofiber · 8s</span></p><p><b>Core Assembler</b><span>2 Gel + 1 Biofiber → 1 Core · 12s</span></p><p className="raw-total"><b>Per Core</b><span>{RAW_PER_CORE.xenograin} Xenograin + {RAW_PER_CORE.water} Water + {RAW_PER_CORE.crystite} Crystite</span></p></div></div>
      <div><h2>Controls</h2><ul><li><kbd>R</kbd> rotate selected build or machine</li><li><kbd>Esc</kbd> cancel construction</li><li><kbd>Space</kbd> pause / resume</li><li><kbd>1</kbd><kbd>2</kbd><kbd>4</kbd> simulation speed</li></ul><h2>Optimization loop</h2><p>Watch real items move, open Analyzer for measured shortages and travel share, then change only what the evidence supports. Demo includes a deliberately wasteful drone route and a shorter teaching example.</p><p className="muted">No network calls occur during gameplay. Progress is saved locally after meaningful changes and every five simulated seconds.</p></div>
    </div><button className="primary" onClick={onClose}>Return to factory</button>
  </section></div>
}

function VictoryDialog({ state, onKeep, onRetry, onMenu, notify }: { state: GameState; onKeep(): void; onRetry(): void; onMenu(): void; notify(message: string, error?: boolean): void }) {
  const victory = state.victory!
  const resultText = `XenoFlow ${state.scenario === 'demo' ? 'Instant Demo' : 'New Factory'} — ${victory.score} points, ${formatTime(victory.completionSeconds)}, ${victory.efficiency.toFixed(1)}% efficiency, ₡${victory.creditsRemaining} remaining, ${victory.travelDistance} drone tiles, ${victory.discarded} discarded.`
  const copy = async () => {
    try { await navigator.clipboard.writeText(resultText); notify('Result copied to clipboard.') }
    catch { notify('Clipboard unavailable. Select the result text below and copy it manually.', true) }
  }
  return <div className="modal-backdrop"><section className="modal victory-modal" role="dialog" aria-modal="true" aria-labelledby="victory-title">
    <div className="victory-orbit"><span>6</span></div><p className="eyebrow">TERRAFORM LINK ESTABLISHED</p><h1 id="victory-title">Six Cores delivered.</h1><p>The colony has enough power to begin atmospheric conversion. Your original result is frozen below.</p>
    <div className="score-display"><span>FINAL SCORE</span><strong>{victory.score.toLocaleString()}</strong></div>
    <dl className="victory-stats"><div><dt>Efficiency</dt><dd>{victory.efficiency.toFixed(1)}%</dd></div><div><dt>Completion</dt><dd>{formatTime(victory.completionSeconds)}</dd></div><div><dt>Credits</dt><dd>₡{victory.creditsRemaining}</dd></div><div><dt>Travel</dt><dd>{victory.travelDistance} tiles</dd></div><div><dt>Discarded</dt><dd>{victory.discarded}</dd></div></dl>
    {victory.bottlenecks.length > 0 && <div className="victory-bottlenecks"><b>Measured bottlenecks</b>{victory.bottlenecks.map((text) => <p key={text}>{text}</p>)}</div>}
    <textarea className="result-fallback" readOnly value={resultText} aria-label="Selectable result text" />
    <div className="button-row centered"><button className="primary" onClick={onKeep}>Keep Optimizing</button><button onClick={onRetry}>Retry</button><button onClick={onMenu}>Main Menu</button><button onClick={copy}>Copy Result</button></div>
  </section></div>
}

export default function App() {
  const gameRef = useRef<GameState | null>(null)
  const [screen, setScreen] = useState<Screen>('menu')
  const [, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [buildKind, setBuildKind] = useState<BuildableKind | null>(null)
  const [demolish, setDemolish] = useState(false)
  const [orientation, setOrientation] = useState<Orientation>(0)
  const [hover, setHover] = useState<Point | null>(null)
  const [dragPath, setDragPath] = useState<Point[]>([])
  const [dockTab, setDockTab] = useState<DockTab>('inspector')
  const [editorSource, setEditorSource] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null)
  const [saveStatus, setSaveStatus] = useState(() => loadGame(window.localStorage))
  const [bestResults, setBestResults] = useState(() => readBestResults(window.localStorage))
  const lastSavedTime = useRef(0)
  const recordedVictory = useRef<number | null>(null)

  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error })
    window.setTimeout(() => setToast((current) => current?.message === message ? null : current), 3500)
  }, [])

  const persist = useCallback((state: GameState) => {
    const result = saveGame(window.localStorage, state)
    if (!result.ok) {
      state.notice = result.message
      notify(result.message, true)
    } else {
      lastSavedTime.current = state.simulatedTime
      setSaveStatus({ ok: true, state })
    }
  }, [notify])

  const mutate = useCallback((fn: (state: GameState) => void, shouldSave = true) => {
    const state = gameRef.current
    if (!state) return
    fn(state)
    if (shouldSave) persist(state)
    setRevision((value) => value + 1)
  }, [persist])

  const startScenario = useCallback((scenario: ScenarioMode, bypassConfirmation = false) => {
    const hasSaved = window.localStorage.getItem(SAVE_KEY) !== null
    if (!bypassConfirmation && hasSaved && !window.confirm('Start a new run and replace the saved factory?')) return
    const state = createScenario(scenario)
    gameRef.current = state
    setEditorSource(state.drone.source)
    setSelectedId(null); setBuildKind(null); setDemolish(false); setDockTab('inspector')
    recordedVictory.current = null
    setScreen('game')
    persist(state)
    setRevision((value) => value + 1)
  }, [persist])

  const continueSaved = useCallback(() => {
    const loaded = loadGame(window.localStorage)
    setSaveStatus(loaded)
    if (!loaded.ok) return
    gameRef.current = loaded.state
    setEditorSource(loaded.state.drone.source)
    recordedVictory.current = loaded.state.victory?.score ?? null
    setScreen('game')
    setRevision((value) => value + 1)
  }, [])

  const returnToMenu = useCallback(() => {
    const state = gameRef.current
    if (state) { state.paused = true; persist(state) }
    setScreen('menu')
    setSaveStatus(loadGame(window.localStorage))
    setBestResults(readBestResults(window.localStorage))
  }, [persist])

  useEffect(() => {
    if (screen !== 'game') return
    let frame = 0
    let last = performance.now()
    let lastUi = last
    let accumulator = 0
    const run = (now: number) => {
      const state = gameRef.current
      const delta = (now - last) / 1000
      last = now
      try {
        if (state && !state.paused) {
          if (delta > 3) {
            state.paused = true
            state.notice = 'Simulation paused after a long rendering stall; no elapsed production was invented.'
            accumulator = 0
          } else {
            accumulator += Math.min(delta, 0.25) * state.speed
            let steps = 0
            while (accumulator + 0.000001 >= STEP_SECONDS && steps < 80) {
              stepSimulation(state)
              accumulator -= STEP_SECONDS
              steps += 1
              if (state.paused) { accumulator = 0; break }
            }
            if (steps >= 80 && accumulator >= STEP_SECONDS) {
              state.paused = true
              state.notice = 'Catch-up limit reached. Simulation paused to keep the browser responsive.'
              accumulator = 0
            }
            if (state.simulatedTime - lastSavedTime.current >= 5) persist(state)
          }
          if (state.victory && recordedVictory.current !== state.victory.score) {
            recordedVictory.current = state.victory.score
            const result = recordBest(window.localStorage, state)
            if (result.ok) setBestResults(result.results)
            else notify(result.message, true)
            persist(state)
          }
        } else accumulator = 0
      } catch (error) {
        if (state) {
          state.paused = true
          state.notice = `Simulation recovered from an error: ${error instanceof Error ? error.message : String(error)}`
          notify(state.notice, true)
          persist(state)
        }
      }
      if (now - lastUi >= 200) { setRevision((value) => value + 1); lastUi = now }
      frame = requestAnimationFrame(run)
    }
    const onVisibility = () => {
      if (document.hidden && gameRef.current) {
        gameRef.current.paused = true
        gameRef.current.notice = 'Paused because the page was hidden.'
        persist(gameRef.current)
        setRevision((value) => value + 1)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    frame = requestAnimationFrame(run)
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', onVisibility) }
  }, [screen, notify, persist])

  useEffect(() => {
    if (screen !== 'game') return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      const state = gameRef.current
      if (!state) return
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        if (buildKind) setOrientation((value) => ((value + 1) % 4) as Orientation)
        else if (selectedId) mutate((draft) => { rotateEntity(draft, selectedId) })
      } else if (event.key === 'Escape') {
        setBuildKind(null); setDemolish(false); setDragPath([])
      } else if (event.code === 'Space') {
        event.preventDefault(); mutate((draft) => { draft.paused = !draft.paused })
      } else if (event.key === '1' || event.key === '2' || event.key === '4') {
        const speed = Number(event.key) as 1 | 2 | 4
        mutate((draft) => { draft.speed = speed; draft.paused = false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, buildKind, selectedId, mutate])

  const state = gameRef.current
  const hoveredProblem = useMemo(() => {
    if (!state || !hover) return null
    if (demolish) {
      const target = entityAt(state, hover.x, hover.y)
      return !target ? 'Nothing to demolish.' : target.protected ? 'Core Uplink is protected.' : `Demolish ${entityName(target.kind)} for ₡${target.kind === 'belt' ? 1 : Math.floor(DEFINITIONS[target.kind as BuildableKind].cost * 0.8)}.`
    }
    if (buildKind) return placementProblem(state, buildKind, hover.x, hover.y) ?? `Place ${DEFINITIONS[buildKind].name} at ${hover.x},${hover.y}.`
    return `Tile ${hover.x},${hover.y}`
  }, [state, hover, demolish, buildKind])

  if (screen === 'menu') {
    return <main className="menu-screen">
      <div className="menu-grid" aria-hidden="true" />
      <section className="menu-hero">
        <div className="menu-logo"><span className="brand-mark large">X</span><div><p>COLONY SYSTEMS // CMU</p><h1>XENOFLOW</h1></div></div>
        <p className="menu-tagline">Harvest alien soil. Route real materials.<br/>Program one drone. Find the bottleneck.</p>
        <div className="menu-actions">
          <button className="primary large-action" onClick={() => startScenario('demo')}><span>INSTANT DEMO</span><small>Run a prebuilt chain with a fixable route</small></button>
          <button className="large-action" onClick={() => startScenario('new')}><span>NEW FACTORY</span><small>500 credits · empty map · build your own</small></button>
          <button className="large-action" disabled={!saveStatus.ok} onClick={continueSaved}><span>CONTINUE</span><small>{saveStatus.ok ? `${saveStatus.state.scenario === 'demo' ? 'Demo' : 'New Factory'} · ${formatTime(saveStatus.state.simulatedTime)} · paused on load` : saveStatus.message}</small></button>
          <button className="text-action" onClick={() => setHelpOpen(true)}>HOW TO PLAY <span>→</span></button>
        </div>
        {!saveStatus.ok && saveStatus.kind !== 'missing' && <div className="save-warning"><b>Saved data needs attention.</b><p>{saveStatus.message}</p><button onClick={() => { if (window.confirm('Delete the unreadable saved factory? This cannot be undone.')) { clearSave(window.localStorage); setSaveStatus(loadGame(window.localStorage)) } }}>Reset saved data</button></div>}
        <div className="best-results"><p className="eyebrow">LOCAL BEST RESULTS</p><span>Demo <b>{bestResults.demo ? `${bestResults.demo.score.toLocaleString()} · ${formatTime(bestResults.demo.seconds)}` : '—'}</b></span><span>New Factory <b>{bestResults.new ? `${bestResults.new.score.toLocaleString()} · ${formatTime(bestResults.new.seconds)}` : '—'}</b></span></div>
      </section>
      <aside className="menu-visual" aria-hidden="true"><div className="planet"><div className="orbit one"/><div className="orbit two"/><div className="planet-core"/></div><div className="flow-line line-a"/><div className="flow-line line-b"/><div className="menu-label label-a">WATER FEED // READY</div><div className="menu-label label-b">DRONE LINK // ONLINE</div><div className="menu-label label-c">CORE UPLINK // WAITING</div></aside>
      <footer className="menu-footer"><span>LOCAL SIMULATION</span><span>NO NETWORK REQUIRED</span><span>BUILD 1.0</span></footer>
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </main>
  }

  if (!state) return null
  const selected = state.entities.find((entity) => entity.id === selectedId)
  const tileAction = (point: Point) => {
    if (state.settings.showCoordinates && !buildKind && !demolish) {
      const text = `${point.x} ${point.y}`
      navigator.clipboard?.writeText(text).then(() => notify(`Coordinates ${text} copied.`)).catch(() => notify(`Coordinates: ${text}`))
      return
    }
    if (demolish) {
      const target = entityAt(state, point.x, point.y)
      if (!target) { notify('Nothing to demolish.', true); return }
      mutate((draft) => {
        const result = demolishEntity(draft, target.id)
        if (!result.ok) notify(result.reason, true)
        else notify(`Demolished ${entityName(target.kind)}: +₡${result.refund}${result.discarded ? `, ${result.discarded} item(s) discarded` : ''}.`)
      })
      return
    }
    if (buildKind && buildKind !== 'belt') {
      mutate((draft) => {
        const result = placeEntity(draft, buildKind, point.x, point.y, orientation)
        if (!result.ok) notify(result.reason, true)
        else { setSelectedId(result.entity.id); notify(`${DEFINITIONS[buildKind].name} placed.`) }
      })
      return
    }
    const target = entityAt(state, point.x, point.y)
    setSelectedId(target?.id ?? null)
    setDockTab('inspector')
  }

  const placeBeltPath = (path: Point[], beltOrientation: Orientation) => {
    mutate((draft) => {
      let placed = 0
      let firstError: string | null = null
      const unique = path.filter((point, index) => path.findIndex((other) => other.x === point.x && other.y === point.y) === index)
      for (const point of unique) {
        const existing = entityAt(draft, point.x, point.y)
        if (existing?.kind === 'belt') continue
        const result = placeEntity(draft, 'belt', point.x, point.y, beltOrientation)
        if (result.ok) placed += 1
        else if (!firstError) firstError = `${point.x},${point.y}: ${result.reason}`
      }
      if (placed) notify(`Placed ${placed} belt${placed === 1 ? '' : 's'} for ₡${placed}.`)
      else notify(firstError ?? 'No new belt tiles were needed.', !!firstError)
    })
  }

  return <main className="game-screen">
    <div className="size-notice"><b>XenoFlow needs a desktop-sized window.</b><span>Use at least 1180 × 720 CSS pixels to keep the full map and controls visible.</span></div>
    <TopHud state={state} mutate={mutate} onMenu={returnToMenu} />
    <div className="game-layout">
      <section className="world-column">
        <Objectives state={state} mutate={mutate} onHelp={() => setHelpOpen(true)} />
        <div className="canvas-frame">
          <WorldCanvas stateRef={gameRef} selectedId={selectedId} hover={hover} buildKind={buildKind} orientation={orientation} dragPath={dragPath} demolish={demolish} onHover={setHover} onDragPreview={(path, facing) => { setDragPath(path); setOrientation(facing) }} onTileAction={tileAction} onBeltDrag={placeBeltPath} />
          <div className="map-corner tl"/><div className="map-corner tr"/><div className="map-corner bl"/><div className="map-corner br"/>
        </div>
        <div className={`map-status ${hoveredProblem?.includes('requires') || hoveredProblem?.includes('occupied') || hoveredProblem?.includes('protected') || hoveredProblem?.includes('Need ') ? 'invalid' : ''}`}><span>{hoveredProblem ?? 'Select a build tool or click the map to inspect.'}</span><button className={state.settings.showCoordinates ? 'active' : ''} onClick={() => mutate((draft) => { draft.settings.showCoordinates = !draft.settings.showCoordinates })}>⌖ {state.settings.showCoordinates ? 'Inspect Coordinates ON' : 'Show Coordinates'}</button></div>
        <Palette state={state} buildKind={buildKind} demolish={demolish} orientation={orientation} selectBuild={(kind) => { setBuildKind(kind); setDemolish(false); setSelectedId(null) }} selectDemolish={() => { setDemolish(true); setBuildKind(null); setSelectedId(null) }} />
      </section>
      <aside className="right-dock">
        <nav className="dock-tabs" aria-label="Factory tools">
          {(['inspector', 'drone', 'analyzer'] as const).map((tab) => <button key={tab} className={dockTab === tab ? 'active' : ''} onClick={() => setDockTab(tab)}>{tab}{tab === 'analyzer' && analyze(state).diagnoses.length > 0 ? <i>{analyze(state).diagnoses.length}</i> : null}</button>)}
        </nav>
        <div className="dock-content">
          {dockTab === 'inspector' && <InspectorPanel state={state} selectedId={selected?.id ?? null} mutate={mutate} setSelected={setSelectedId} setTool={() => { setDemolish(true); setBuildKind(null) }} />}
          {dockTab === 'drone' && <DronePanel state={state} source={editorSource} setSource={setEditorSource} mutate={mutate} notify={notify} />}
          {dockTab === 'analyzer' && <AnalyzerPanel state={state} mutate={mutate} setSelected={(id) => { setSelectedId(id); setDockTab('inspector') }} notify={notify} />}
        </div>
        <div className="dock-footer"><span className={state.paused ? 'paused' : 'online'}><i />{state.paused ? 'SIM PAUSED' : `SIM ONLINE · ${state.speed}×`}</span><span>AUTOSAVE {Math.max(0, Math.floor(state.simulatedTime - lastSavedTime.current))}s</span></div>
      </aside>
    </div>
    {state.notice && <button className="system-notice" onClick={() => mutate((draft) => { draft.notice = null })}><b>SYSTEM NOTICE</b>{state.notice}<span>×</span></button>}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.message}</div>}
    {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    {state.victory && !state.victoryAcknowledged && <VictoryDialog state={state} notify={notify} onKeep={() => mutate((draft) => keepOptimizing(draft))} onRetry={() => startScenario(state.scenario)} onMenu={returnToMenu} />}
  </main>
}
