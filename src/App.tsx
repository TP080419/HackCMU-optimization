import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { benchmarkImprovement, runBenchmark } from './v2/benchmark'
import { BASELINE_PROGRAM, LOOP_PROGRAM, PHASES, STARTER_PROGRAM, UNLOCKED_BUILDINGS_BY_PHASE } from './v2/config'
import { XenoFlowEngine } from './v2/engine'
import { loadGame, loadSettings, saveGame } from './v2/save'
import { cloneState, createInitialState } from './v2/simulation'
import type { BenchmarkResult, EntityKind, ItemId, SimulationEvent, SimulationStateV2 } from './v2/types'

const PhaserWorld = lazy(() => import('./v2/rendering/PhaserWorld').then((module) => ({ default: module.PhaserWorld })))
const CodeWorkbench = lazy(() => import('./v2/ui/CodeWorkbench').then((module) => ({ default: module.CodeWorkbench })))

interface ErrorBoundaryState {
  error: Error | null
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('XenoFlow runtime failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="fatal-screen">
        <span className="eyebrow">SECTOR RENDER FAILURE</span>
        <h1>世界渲染暂时中断</h1>
        <p>{this.state.error.message}</p>
        <button type="button" onClick={() => location.reload()}>重新载入 Sector 01</button>
      </main>
    )
  }
}

const BUILD_META: Partial<Record<EntityKind, { label: string; hint: string; cost: number }>> = {
  belt: { label: '双轨输送带', hint: '连续运输两个通道的物品', cost: 2 },
  inserter: { label: '机械臂', hint: '在机器与物流之间实体搬运', cost: 9 },
  hopper: { label: '缓冲仓', hint: '批量接收无人机投递', cost: 14 },
  waterExtractor: { label: '取水器', hint: '从水面提取 Water', cost: 35 },
  crystiteDrill: { label: '晶体钻机', hint: '开采 Crystite', cost: 45 },
  gelRefinery: { label: '营养胶精炼机', hint: '2 Grain + Water → Gel', cost: 60 },
  fiberMill: { label: '生物纤维磨坊', hint: 'Grain + Crystite → Biofiber', cost: 65 },
  coreAssembler: { label: '核心组装机', hint: 'Gel + Biofiber → Core', cost: 100 },
  pylon: { label: '太阳能塔', hint: '提高供电容量', cost: 50 },
}

const ITEM_LABELS: Record<ItemId, string> = {
  xenograin: 'Xenograin',
  water: 'Water',
  crystite: 'Crystite',
  gel: 'Nutrient Gel',
  biofiber: 'Biofiber',
  core: 'Terraform Core',
}

function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function cargoTotal(state: SimulationStateV2) {
  return state.drone.cargo.reduce((total, stack) => total + stack.amount, 0)
}

function coreRate(state: SimulationStateV2) {
  const recent = state.metrics.coreProductionTimes.filter((time) => time >= state.timeMs - 60_000).length
  return state.timeMs < 60_000 ? recent * (60_000 / Math.max(1, state.timeMs)) : recent
}

function emptyTravel(state: SimulationStateV2) {
  const total = state.drone.emptyDistance + state.drone.loadedDistance
  return total > 0 ? (state.drone.emptyDistance / total) * 100 : 0
}

function eventTone(event: SimulationEvent) {
  if (event.type === 'coreDelivered') return [680, 0.22] as const
  if (event.type === 'phaseAdvanced') return [520, 0.28] as const
  if (event.type === 'machineCycle') return [220, 0.08] as const
  if (event.type === 'droneAction' && event.action === 'harvest') return [360, 0.07] as const
  if (event.type === 'worldEdited' && event.action === 'build') return [300, 0.06] as const
  if (event.type === 'worldEdited' && event.action === 'rotate') return [410, 0.05] as const
  if (event.type === 'worldEdited' && event.action === 'demolish') return [150, 0.08] as const
  return null
}

function BuildingGlyph({ kind }: { kind: EntityKind }) {
  if (kind === 'belt') return <svg viewBox="0 0 40 40"><path d="M5 13h30v14H5z"/><path d="m11 17 5 3-5 3m9-6 5 3-5 3m9-6 5 3-5 3"/></svg>
  if (kind === 'inserter') return <svg viewBox="0 0 40 40"><circle cx="11" cy="29" r="6"/><path d="m11 24 8-13 9 7 6-5m-8 5 5 7"/></svg>
  if (kind === 'hopper') return <svg viewBox="0 0 40 40"><path d="M7 8h26l-5 16-6 3v6h-5v-6l-6-3z"/></svg>
  if (kind === 'waterExtractor') return <svg viewBox="0 0 40 40"><circle cx="20" cy="21" r="12"/><circle cx="20" cy="21" r="6"/><path d="M20 9V4m8 9 5-4"/></svg>
  if (kind === 'crystiteDrill') return <svg viewBox="0 0 40 40"><path d="m20 4 8 13-8 19-8-19z"/><path d="M8 30h24"/></svg>
  if (kind === 'gelRefinery') return <svg viewBox="0 0 40 40"><rect x="7" y="6" width="26" height="29" rx="8"/><path d="M12 21h16M20 10v22"/><circle cx="20" cy="22" r="7"/></svg>
  if (kind === 'fiberMill') return <svg viewBox="0 0 40 40"><rect x="5" y="8" width="30" height="25" rx="4"/><circle cx="14" cy="20" r="6"/><circle cx="27" cy="20" r="6"/><path d="M14 14v12m13-12v12"/></svg>
  if (kind === 'coreAssembler') return <svg viewBox="0 0 40 40"><path d="m20 3 15 9v17l-15 8-15-8V12z"/><path d="m20 10 8 10-8 10-8-10z"/></svg>
  return <svg viewBox="0 0 40 40"><path d="M14 35h12l-3-24h-6zM9 17h22M6 8h28"/><circle cx="20" cy="6" r="4"/></svg>
}

function LaunchScreen({ hasSave, onStart, onContinue }: { hasSave: boolean; onStart: () => void; onContinue: () => void }) {
  return (
    <main className="launch-screen">
      <div className="launch-art" />
      <div className="launch-vignette" />
      <section className="launch-copy">
        <div className="brand-lockup">
          <span className="brand-mark">X</span>
          <span>XENOFLOW</span>
        </div>
        <span className="eyebrow">SECTOR 01 // THE LIVING LINE</span>
        <h1>让农场读懂<br />工厂的饥饿。</h1>
        <p>编写一架农业无人机，让它观察成熟度与实时需求；再重排实体产线，把一次收获变成持续吞吐。</p>
        <div className="launch-actions">
          <button className="launch-primary" type="button" onClick={hasSave ? onContinue : onStart}>{hasSave ? '继续 Sector 01' : '启动 Sector 01'}</button>
          {hasSave && <button className="launch-secondary" type="button" onClick={onStart}>从头开始</button>}
        </div>
        <div className="launch-features">
          <span><b>01</b> 确定性模拟</span>
          <span><b>02</b> 安全 Python-like</span>
          <span><b>03</b> 同快照 Benchmark</span>
        </div>
      </section>
      <span className="launch-build">V2 CORE / LOCAL BUILD</span>
    </main>
  )
}

interface BenchmarkPanelProps {
  baseline: BenchmarkResult | null
  candidate: BenchmarkResult | null
  snapshotTick: number | null
  running: boolean
  onClose: () => void
  onRun: () => void
  onCapture: () => void
}

function BenchmarkPanel({ baseline, candidate, snapshotTick, running, onClose, onRun, onCapture }: BenchmarkPanelProps) {
  const improvement = baseline && candidate ? benchmarkImprovement(baseline, candidate) : null
  const rows: Array<[string, keyof BenchmarkResult, string]> = [
    ['Core / min', 'coresPerMinute', '越高越好'],
    ['空载移动', 'emptyTravelPercent', '越低越好'],
    ['Grain 格距 / 单位', 'xenograinDistancePerUnit', '越低越好'],
    ['Refinery 缺料', 'refineryStarvedPercent', '越低越好'],
    ['Mill 缺料', 'millStarvedPercent', '越低越好'],
    ['Belt 堵塞', 'beltBlockedPercent', '越低越好'],
    ['能耗', 'energyUsed', '越低越好'],
  ]
  return (
    <section className="benchmark-panel" aria-label="Benchmark comparison">
      <header>
        <div><span className="eyebrow">DETERMINISTIC / 120 SIM SEC</span><h2>同快照 Benchmark</h2></div>
        <button className="icon-button" type="button" onClick={onClose}>×</button>
      </header>
      <p>复制当前世界，从完全相同的 tick 分别运行基线与当前程序；不会修改正式存档。</p>
      <div className="benchmark-snapshot">
        <span>LOCKED SNAPSHOT // TICK {snapshotTick ?? '—'}</span>
        <button type="button" disabled={running} onClick={onCapture}>更新基准快照</button>
      </div>
      <div className="benchmark-summary">
        <div><span>产量变化</span><strong>{improvement ? `${improvement.outputGain >= 0 ? '+' : ''}${improvement.outputGain}%` : '—'}</strong></div>
        <div><span>空载减少</span><strong>{improvement ? `${improvement.emptyReduction >= 0 ? '+' : ''}${improvement.emptyReduction}%` : '—'}</strong></div>
      </div>
      <div className="benchmark-table">
        <div className="benchmark-row benchmark-head"><span>指标</span><span>初始程序</span><span>当前程序</span></div>
        {rows.map(([label, key, hint]) => (
          <div className="benchmark-row" key={key} title={hint}>
            <span>{label}</span>
            <b>{baseline ? String(baseline[key]) : '—'}{String(key).includes('Percent') ? '%' : ''}</b>
            <b>{candidate ? String(candidate[key]) : '—'}{String(key).includes('Percent') ? '%' : ''}</b>
          </div>
        ))}
      </div>
      <button className="primary-action benchmark-run" type="button" disabled={running} onClick={onRun}>{running ? '正在模拟 2 × 120 秒…' : '从当前快照重新运行'}</button>
    </section>
  )
}

function App() {
  const savedAtBoot = useMemo(() => loadGame(), [])
  const settingsAtBoot = useMemo(() => loadSettings(), [])
  const engine = useMemo(() => {
    const initial = savedAtBoot ?? createInitialState()
    initial.settings = { ...settingsAtBoot }
    return new XenoFlowEngine(initial)
  }, [savedAtBoot, settingsAtBoot])
  const [revision, setRevision] = useState(0)
  const [entered, setEntered] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [benchmarkOpen, setBenchmarkOpen] = useState(false)
  const [benchmarkRunning, setBenchmarkRunning] = useState(false)
  const [baseline, setBaseline] = useState<BenchmarkResult | null>(null)
  const [candidate, setCandidate] = useState<BenchmarkResult | null>(null)
  const [benchmarkTick, setBenchmarkTick] = useState<number | null>(null)
  const [buildTool, setBuildTool] = useState<EntityKind | null>(null)
  const [codeSource, setCodeSource] = useState(engine.getState().runtime.source)
  const [insertion, setInsertion] = useState<{ name: string; nonce: number } | null>(null)
  const [toast, setToast] = useState('')
  // A restored save may contain historical events. Mark its newest event as
  // already observed so the launch screen never creates audio without a user
  // gesture or replays an old completion sound.
  const lastEventId = useRef(engine.getState().events.at(-1)?.id ?? '')
  const audioRef = useRef<AudioContext | null>(null)
  const ambientRef = useRef<{ oscillators: OscillatorNode[]; gain: GainNode } | null>(null)
  const benchmarkSnapshotRef = useRef<SimulationStateV2 | null>(null)
  const state = engine.getState()
  void revision

  useEffect(() => engine.subscribe(() => setRevision((value) => value + 1)), [engine])

  useEffect(() => {
    let frame = 0
    let previous = performance.now()
    const loop = (now: number) => {
      engine.dispatch({ type: 'advance', elapsedMs: now - previous })
      previous = now
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [engine])

  useEffect(() => {
    if (!entered || state.tick === 0 || state.tick % 50 !== 0) return
    saveGame(state)
  }, [entered, state, state.tick])

  const playTone = useCallback((frequency: number, duration: number) => {
    const current = engine.getState()
    if (current.settings.muted || current.settings.volume <= 0) return
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    const audio = audioRef.current ?? new AudioCtor()
    audioRef.current = audio
    void audio.resume()
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime)
    gain.gain.setValueAtTime(current.settings.volume * 0.08, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start()
    oscillator.stop(audio.currentTime + duration)
  }, [engine])

  const startAmbient = useCallback(() => {
    const current = engine.getState()
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    const audio = audioRef.current ?? new AudioCtor()
    audioRef.current = audio
    void audio.resume()
    if (ambientRef.current) return
    const filter = audio.createBiquadFilter()
    const gain = audio.createGain()
    filter.type = 'lowpass'
    filter.frequency.value = 190
    gain.gain.value = current.settings.muted ? 0 : current.settings.volume * 0.012
    const oscillators = [48, 72].map((frequency, index) => {
      const oscillator = audio.createOscillator()
      oscillator.type = index === 0 ? 'sine' : 'triangle'
      oscillator.frequency.value = frequency
      oscillator.detune.value = index === 0 ? -4 : 5
      oscillator.connect(filter)
      oscillator.start()
      return oscillator
    })
    filter.connect(gain).connect(audio.destination)
    ambientRef.current = { oscillators, gain }
  }, [engine])

  useEffect(() => {
    const ambient = ambientRef.current
    const audio = audioRef.current
    if (!ambient || !audio) return
    ambient.gain.gain.setTargetAtTime(state.settings.muted ? 0 : state.settings.volume * 0.012, audio.currentTime, 0.08)
  }, [state.settings.muted, state.settings.volume])

  useEffect(() => () => {
    for (const oscillator of ambientRef.current?.oscillators ?? []) oscillator.stop()
    ambientRef.current = null
    if (audioRef.current) void audioRef.current.close()
    audioRef.current = null
  }, [])

  const captureBenchmarkSnapshot = useCallback(() => {
    const snapshot = cloneState(engine.getState())
    benchmarkSnapshotRef.current = snapshot
    setBenchmarkTick(snapshot.tick)
    setBaseline(null)
    setCandidate(null)
  }, [engine])

  const toggleBenchmark = useCallback(() => {
    if (engine.getState().mission.phase < 4) return
    if (!benchmarkOpen && !benchmarkSnapshotRef.current) captureBenchmarkSnapshot()
    setBenchmarkOpen((open) => !open)
  }, [benchmarkOpen, captureBenchmarkSnapshot, engine])

  useEffect(() => {
    if (!entered) return
    const event = state.events[state.events.length - 1]
    if (!event || event.id === lastEventId.current) return
    lastEventId.current = event.id
    const tone = eventTone(event)
    if (tone) playTone(tone[0], tone[1])
    if (event.type === 'phaseAdvanced') {
      const phase = PHASES[event.phase - 1]
      setToast(`新阶段：${phase.title}`)
      const timer = window.setTimeout(() => setToast(''), 3_800)
      return () => window.clearTimeout(timer)
    }
  }, [entered, playTone, state.events])

  useEffect(() => {
    const selected = state.entities.find((entity) => entity.id === state.selectedEntityId)
    if (!codeOpen || !selected || ['crop', 'belt', 'inserter', 'ruin'].includes(selected.kind)) return
    setInsertion({ name: selected.name, nonce: performance.now() })
  }, [codeOpen, state.selectedEntityId])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = Boolean(target?.closest('input, textarea, [contenteditable="true"], .cm-editor'))
      if (event.key === 'Escape') {
        setBuildTool(null)
        setSettingsOpen(false)
      }
      if (!typing && event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.metaKey) toggleBenchmark()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [toggleBenchmark])

  const startFresh = () => {
    const fresh = createInitialState(STARTER_PROGRAM)
    fresh.settings = { ...engine.getState().settings }
    engine.dispatch({ type: 'loadState', state: fresh })
    saveGame(fresh)
    benchmarkSnapshotRef.current = null
    setBenchmarkTick(null)
    setBaseline(null)
    setCandidate(null)
    setCodeSource(STARTER_PROGRAM)
    setEntered(true)
    startAmbient()
    playTone(440, 0.16)
  }

  const continueGame = () => {
    setEntered(true)
    setCodeSource(engine.getState().runtime.source)
    startAmbient()
    playTone(440, 0.16)
  }

  const runCode = () => {
    if (codeSource !== state.runtime.source) engine.dispatch({ type: 'loadProgram', source: codeSource })
    engine.dispatch({ type: 'runProgram' })
    playTone(460, 0.06)
  }

  const useLoopExample = () => {
    setCodeSource(BASELINE_PROGRAM)
    engine.dispatch({ type: 'loadProgram', source: BASELINE_PROGRAM })
    setCodeOpen(true)
  }

  const useDemandExample = () => {
    setCodeSource(LOOP_PROGRAM)
    engine.dispatch({ type: 'loadProgram', source: LOOP_PROGRAM })
    setCodeOpen(true)
  }

  const runBenchmarks = () => {
    setBenchmarkRunning(true)
    window.setTimeout(() => {
      const snapshot = benchmarkSnapshotRef.current ?? cloneState(engine.getState())
      if (!benchmarkSnapshotRef.current) {
        benchmarkSnapshotRef.current = snapshot
        setBenchmarkTick(snapshot.tick)
      }
      setBaseline(runBenchmark(snapshot, BASELINE_PROGRAM))
      setCandidate(runBenchmark(snapshot, codeSource))
      setBenchmarkRunning(false)
      playTone(620, 0.16)
    }, 20)
  }

  const setSetting = (key: 'muted' | 'volume' | 'reducedMotion', value: boolean | number) => {
    engine.dispatch({ type: 'setSetting', key, value })
    saveGame(engine.getState())
  }

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  }

  if (!entered) return <LaunchScreen hasSave={Boolean(savedAtBoot)} onStart={startFresh} onContinue={continueGame} />

  const phase = PHASES[state.mission.phase - 1]
  const selected = state.entities.find((entity) => entity.id === state.selectedEntityId)
  const unlocked = UNLOCKED_BUILDINGS_BY_PHASE[state.mission.phase] ?? []
  const topLines = Object.entries(state.runtime.lineCosts).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const totalCargo = cargoTotal(state)
  return (
    <main className={`game-shell ${codeOpen ? 'code-is-open' : ''} ${state.settings.reducedMotion ? 'reduced-motion' : ''}`}>
      <div className="world-stage">
        <Suspense fallback={<div className="world-loading"><span>正在建立 Sector 01…</span></div>}>
          <PhaserWorld engine={engine} buildTool={buildTool} onToggleCode={() => setCodeOpen((open) => !open)} />
        </Suspense>
        <div className="world-shade" />

        <header className="floating-hud">
          <div className="hud-brand" title="XenoFlow V2">
            <span className="brand-mark small">X</span>
            <span><b>XENOFLOW</b><small>THE LIVING LINE</small></span>
          </div>
          <div className="resource-strip">
            <span><small>CREDITS</small><b>₡ {state.credits}</b></span>
            <span><small>CORE</small><b>{state.metrics.coresDelivered} / 6</b></span>
            <span><small>CARGO</small><b>{totalCargo} / {state.drone.capacity}</b></span>
            <span><small>POWER</small><b className={state.power.stability < 90 ? 'warning-text' : ''}>{Math.round(state.power.demand)} / {state.power.capacity}</b></span>
          </div>
          <div className="sim-controls">
            <button type="button" className="pause-button" onClick={() => engine.dispatch({ type: 'togglePause' })}>{state.paused ? '▶ 继续' : 'Ⅱ 暂停'}</button>
            {([1, 2, 4] as const).map((speed) => <button className={state.speed === speed ? 'active' : ''} key={speed} type="button" onClick={() => engine.dispatch({ type: 'setSpeed', speed })}>{speed}×</button>)}
            <span className="sim-clock">{formatTime(state.timeMs)}</span>
          </div>
        </header>

        <section className="objective-card">
          <div className="objective-index">0{state.mission.phase}</div>
          <div><span className="eyebrow">{phase.title}</span><h2>{phase.objective}</h2><p>{phase.hint}</p></div>
          {state.mission.phase === 1 && <button className="objective-action" type="button" onClick={() => setCodeOpen(true)}>打开唤醒程序</button>}
          {state.mission.phase === 2 && <button className="objective-action" type="button" onClick={useLoopExample}>载入循环示例</button>}
          {state.mission.phase === 4 && <button className="objective-action" type="button" onClick={useDemandExample}>载入需求调度模板</button>}
          {state.mission.phase === 5 && <div className="stability-meter"><span style={{ width: `${Math.min(100, state.mission.stabilityMs / 900)}%` }} /><b>{Math.floor(state.mission.stabilityMs / 1000)} / 90s</b></div>}
        </section>

        <nav className="world-tools" aria-label="World tools">
          <button className={state.flowVision ? 'active' : ''} type="button" onClick={() => engine.dispatch({ type: 'toggleFlowVision' })}><span>⌁</span>Flow Vision <kbd>Tab</kbd></button>
          <button className={benchmarkOpen ? 'active' : ''} type="button" disabled={state.mission.phase < 4} title={state.mission.phase < 4 ? '接通工厂后解锁' : '从相同快照比较程序'} onClick={toggleBenchmark}><span>◫</span>Benchmark <kbd>B</kbd></button>
          <button className={codeOpen ? 'active' : ''} type="button" onClick={() => setCodeOpen((open) => !open)}><span>{'</>'}</span>Code <kbd>C</kbd></button>
          <button type="button" onClick={() => void toggleFullscreen()} aria-label="切换全屏">⛶</button>
          <button type="button" onClick={() => setSettingsOpen((open) => !open)} aria-label="打开设置">⚙</button>
        </nav>

        {settingsOpen && (
          <section className="settings-popover">
            <header><span className="eyebrow">LOCAL SETTINGS</span><button className="icon-button" type="button" onClick={() => setSettingsOpen(false)}>×</button></header>
            <label><span>音量</span><input type="range" min="0" max="1" step="0.05" value={state.settings.volume} onChange={(event) => setSetting('volume', Number(event.target.value))} /></label>
            <label><span>静音</span><input type="checkbox" checked={state.settings.muted} onChange={(event) => setSetting('muted', event.target.checked)} /></label>
            <label><span>Reduced motion</span><input type="checkbox" checked={state.settings.reducedMotion} onChange={(event) => setSetting('reducedMotion', event.target.checked)} /></label>
            <small>设置与游戏存档只保存在本浏览器的 xenoflow.v2.* 命名空间。</small>
          </section>
        )}

        {selected && (
          <section className={`context-card status-${selected.status} ${state.flowVision ? 'with-flow' : ''}`}>
            <header><span className="status-dot" /><div><small>{selected.kind}</small><h3>{selected.name}</h3></div><button className="icon-button" type="button" onClick={() => engine.dispatch({ type: 'selectEntity', entityId: null })}>×</button></header>
            <div className="context-stats">
              <span><small>STATUS</small><b>{selected.status}</b></span>
              <span><small>PROCESS</small><b>{Math.round(selected.progress * 100)}%</b></span>
            </div>
            {Object.keys(selected.inputs).length > 0 && <p>输入：{Object.entries(selected.inputs).map(([item, value]) => `${ITEM_LABELS[item as ItemId]} ${value}`).join(' · ')}</p>}
            {Object.keys(selected.outputs).length > 0 && <p>输出：{Object.entries(selected.outputs).map(([item, value]) => `${ITEM_LABELS[item as ItemId]} ${value}`).join(' · ')}</p>}
            <footer>
              <button type="button" onClick={() => engine.dispatch({ type: 'rotateEntity', entityId: selected.id })}>旋转 R</button>
              {codeOpen && !['crop', 'belt', 'inserter', 'ruin'].includes(selected.kind) && <span>名称已插入代码</span>}
            </footer>
          </section>
        )}

        {state.flowVision && (
          <section className="flow-card">
            <header><span className="eyebrow">FLOW VISION</span><strong>{coreRate(state).toFixed(1)} Core/min</strong></header>
            <div className="flow-metrics">
              <span><i className="loaded-line" />载货路径 {Math.round(state.drone.loadedDistance)} 格</span>
              <span><i className="empty-line" />空载路径 {emptyTravel(state).toFixed(1)}%</span>
            </div>
            <p>最耗时代码：{topLines.length ? topLines.map(([line, cost]) => `L${line} · ${cost}`).join(' / ') : '运行程序后显示'}</p>
          </section>
        )}

        <section className="build-dock">
          <div className="dock-handle"><span>BUILD // PHASE {state.mission.phase}</span><small>{buildTool ? `正在放置 ${BUILD_META[buildTool]?.label} · Esc 取消` : '拖动镜头 · 滚轮缩放 · Shift 拖动机器 · 双击聚焦'}</small></div>
          <div className="build-items">
            {unlocked.length === 0 ? <div className="locked-build-message">完成农业程序后，将解锁实体物流。</div> : unlocked.map((kind) => {
              const meta = BUILD_META[kind]
              if (!meta) return null
              return (
                <button className={buildTool === kind ? 'selected' : ''} type="button" key={kind} onClick={() => setBuildTool((current) => current === kind ? null : kind)} title={meta.hint}>
                  <span className="build-icon"><BuildingGlyph kind={kind} /></span>
                  <span><b>{meta.label}</b><small>₡{meta.cost}</small></span>
                </button>
              )
            })}
          </div>
        </section>

        {toast && <div className="world-toast"><span>✓</span>{toast}</div>}
      </div>

      {codeOpen && (
        <Suspense fallback={<aside className="code-workbench workbench-loading">正在载入代码工作台…</aside>}>
          <CodeWorkbench
            source={codeSource}
            runtime={state.runtime}
            drone={state.drone}
            insertion={insertion}
            onChange={setCodeSource}
            onRun={runCode}
            onPause={() => engine.dispatch({ type: 'pauseProgram' })}
            onStep={() => engine.dispatch({ type: 'stepProgram' })}
            onReset={() => engine.dispatch({ type: 'resetProgram' })}
            onClose={() => setCodeOpen(false)}
          />
        </Suspense>
      )}
      {benchmarkOpen && <BenchmarkPanel baseline={baseline} candidate={candidate} snapshotTick={benchmarkTick} running={benchmarkRunning} onClose={() => setBenchmarkOpen(false)} onRun={runBenchmarks} onCapture={captureBenchmarkSnapshot} />}
    </main>
  )
}

export default App
