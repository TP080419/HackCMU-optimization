import { describe, expect, it } from 'vitest'
import { BASELINE_PROGRAM, LOOP_PROGRAM, SIM_STEP_MS, STARTER_PROGRAM } from './config'
import { runBenchmark } from './benchmark'
import { XenoFlowEngine } from './engine'
import { loadGame, loadSettings, saveGame } from './save'
import { advanceSimulation, applyGameCommand, cloneState, createInitialState, createRenderSnapshot } from './simulation'

function run(state: ReturnType<typeof createInitialState>, milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += SIM_STEP_MS) advanceSimulation(state, SIM_STEP_MS)
  return state
}

function operationalState() {
  const state = createInitialState()
  state.mission.phase = 3
  applyGameCommand(state, { type: 'build', kind: 'inserter', x: 11, y: 6 })
  applyGameCommand(state, { type: 'build', kind: 'inserter', x: 11, y: 11 })
  state.mission.phase = 4
  return state
}

const FUNCTIONAL_PROGRAM = `def feed(machine, endpoint, batch):
    if need(machine, XENOGRAIN) >= batch:
        move_to(endpoint)
        unload(endpoint, XENOGRAIN, batch)

while True:
    for plot in farm_zone():
        if is_ripe(plot) and cargo_free() > 0:
            move_to(plot)
            harvest()
    feed("gel_refinery", "gel_input", 2)
    feed("fiber_mill", "fiber_input", 1)
    wait(0.4)`

const PRIORITY_PROGRAM = `while True:
    for plot in farm_zone():
        if is_ripe(plot) and cargo_free() > 0:
            move_to(plot)
            harvest()
    if need("fiber_mill", XENOGRAIN) >= 1:
        move_to("fiber_input")
        unload("fiber_input", XENOGRAIN, 1)
    if need("gel_refinery", XENOGRAIN) >= 2:
        move_to("gel_input")
        unload("gel_input", XENOGRAIN, 2)
    wait(0.25)`

describe('XenoFlow V2 deterministic simulation', () => {
  it('harvests two seeds, replants one, and carries the net Xenograin', () => {
    const state = createInitialState(STARTER_PROGRAM)
    applyGameCommand(state, { type: 'runProgram' })
    run(state, 4_000)
    const plot = state.entities.find((candidate) => candidate.id === 'plot-0-0')
    expect(plot?.cropStage).toBe('planted')
    expect(state.drone.cargo).toEqual([{ item: 'xenograin', amount: 1 }])
    run(state, 4_000)
    expect(state.mission.completedObjectives).toContain('first-unload')
    expect(state.mission.phase).toBeGreaterThanOrEqual(2)
  })

  it('shows the empty crop stage and spends one Xenograin when planting it', () => {
    const state = createInitialState(`move_to("plot-0-0")
harvest()
move_to("plot-5-2")
plant()`)
    state.mission.phase = 2
    expect(state.entities.find((candidate) => candidate.id === 'plot-5-2')?.cropStage).toBe('empty')
    applyGameCommand(state, { type: 'runProgram' })
    run(state, 12_000)
    expect(state.entities.find((candidate) => candidate.id === 'plot-5-2')?.cropStage).toBe('planted')
    expect(state.drone.cargo).toEqual([])
  })

  it('produces identical snapshots from the same state and program', () => {
    const first = createInitialState(LOOP_PROGRAM)
    first.mission.phase = 4
    const second = cloneState(first)
    applyGameCommand(first, { type: 'runProgram' })
    applyGameCommand(second, { type: 'runProgram' })
    run(first, 30_000)
    run(second, 30_000)
    expect(second).toEqual(first)
  })

  it('retains long-frame simulation backlog instead of dropping deterministic ticks', () => {
    const engine = new XenoFlowEngine(createInitialState())
    engine.dispatch({ type: 'setPaused', paused: false })
    engine.dispatch({ type: 'advance', elapsedMs: 20_000 })
    expect(engine.getState().tick).toBe(120)
    engine.dispatch({ type: 'advance', elapsedMs: 0 })
    expect(engine.getState().tick).toBe(200)
  })

  it('moves independent items through dual-lane belts', () => {
    const state = createInitialState(LOOP_PROGRAM)
    const belt = state.entities.find((candidate) => candidate.id === 'gel-belt-16')!
    belt.beltItems = [
      { id: 900, item: 'gel', lane: 0, progress: 0 },
      { id: 901, item: 'gel', lane: 1, progress: 0.1 },
    ]
    run(state, 500)
    expect(belt.beltItems).toHaveLength(2)
    expect(belt.beltItems?.[0].progress).toBeGreaterThan(0)
    run(state, 1_500)
    expect(createRenderSnapshot(state).entities.find((candidate) => candidate.id === belt.id)?.itemsPerMinute).toBeGreaterThan(0)
  })

  it('auto-connects player-built Belt and Inserter logistics by direction', () => {
    const state = createInitialState()
    state.mission.phase = 5
    state.credits = 500
    applyGameCommand(state, { type: 'build', kind: 'gelRefinery', x: 3, y: 0 })
    applyGameCommand(state, { type: 'build', kind: 'inserter', x: 2, y: 0, direction: 'east' })
    applyGameCommand(state, { type: 'build', kind: 'belt', x: 1, y: 0, direction: 'east' })
    const belt = state.entities.find((candidate) => candidate.kind === 'belt' && candidate.x === 1 && candidate.y === 0)!
    const arm = state.entities.find((candidate) => candidate.kind === 'inserter' && candidate.x === 2 && candidate.y === 0)!
    const machine = state.entities.find((candidate) => candidate.kind === 'gelRefinery' && candidate.x === 3 && candidate.y === 0)!
    belt.beltItems?.push({ id: 990, item: 'xenograin', lane: 0, progress: 0.9 })
    run(state, 2_500)
    expect(belt.targetId).toBe(arm.id)
    expect(arm.targetId).toBe(machine.id)
    expect(machine.inputs.xenograin).toBe(1)
  })

  it('requires an Inserter between a player-built Belt and machine', () => {
    const state = createInitialState()
    state.mission.phase = 5
    state.credits = 500
    applyGameCommand(state, { type: 'build', kind: 'gelRefinery', x: 2, y: 0 })
    applyGameCommand(state, { type: 'build', kind: 'belt', x: 1, y: 0, direction: 'east' })
    const belt = state.entities.find((candidate) => candidate.kind === 'belt' && candidate.x === 1 && candidate.y === 0)!
    const machine = state.entities.find((candidate) => candidate.kind === 'gelRefinery' && candidate.x === 2 && candidate.y === 0)!
    belt.beltItems?.push({ id: 991, item: 'xenograin', lane: 0, progress: 0.9 })
    run(state, 2_500)
    expect(belt.targetId).toBeUndefined()
    expect(belt.status).toBe('blocked')
    expect(machine.inputs.xenograin ?? 0).toBe(0)
  })

  it('rejects placement that overlaps any part of a multi-tile machine', () => {
    const state = createInitialState()
    state.mission.phase = 5
    state.credits = 500
    applyGameCommand(state, { type: 'build', kind: 'gelRefinery', x: 0, y: 0 })
    const before = state.entities.length
    applyGameCommand(state, { type: 'build', kind: 'hopper', x: 2, y: 2 })
    expect(state.entities).toHaveLength(before)
  })

  it('emits located feedback events for build, rotate, move, and demolish edits', () => {
    const state = createInitialState()
    state.mission.phase = 5
    applyGameCommand(state, { type: 'build', kind: 'belt', x: 0, y: 0, direction: 'east' })
    const belt = state.entities.find((candidate) => candidate.kind === 'belt' && candidate.x === 0 && candidate.y === 0)!
    applyGameCommand(state, { type: 'rotateEntity', entityId: belt.id })
    applyGameCommand(state, { type: 'moveEntity', entityId: belt.id, x: 1, y: 0 })
    applyGameCommand(state, { type: 'demolish', entityId: belt.id })
    expect(state.events.filter((event) => event.type === 'worldEdited').map((event) => event.action)).toEqual(['build', 'rotate', 'move', 'demolish'])
  })

  it('benchmarks without mutating the live save', () => {
    const state = createInitialState()
    const before = cloneState(state)
    const result = runBenchmark(state, LOOP_PROGRAM, 20_000)
    expect(result.simulatedMs).toBe(20_000)
    expect(state).toEqual(before)
  })

  it('the demand-driven program materially outperforms the starter route', () => {
    const initial = runBenchmark(operationalState(), BASELINE_PROGRAM)
    const optimized = runBenchmark(operationalState(), LOOP_PROGRAM)
    expect(initial.coresProduced).toBeGreaterThan(0)
    expect(optimized.coresProduced).toBeGreaterThan(initial.coresProduced)
    expect(optimized.coresPerMinute).toBeGreaterThanOrEqual(initial.coresPerMinute * 1.15)
    expect(optimized.emptyTravelPercent).toBeLessThan(initial.emptyTravelPercent * 0.8)
  })

  it('makes a changed program path visible within twenty simulated seconds', () => {
    const initial = runBenchmark(operationalState(), BASELINE_PROGRAM, 20_000)
    const optimized = runBenchmark(operationalState(), LOOP_PROGRAM, 20_000)
    expect(optimized.emptyTravelPercent).not.toBe(initial.emptyTravelPercent)
  })

  it('keeps save/load deterministic in the v2 namespace', () => {
    const values = new Map<string, string>([['xenoflow.v1.save', 'preserve-me']])
    const storage = {
      setItem(key: string, value: string) { values.set(key, value) },
      getItem(key: string) { return values.get(key) ?? null },
    }
    const state = createInitialState(LOOP_PROGRAM)
    state.mission.phase = 4
    state.settings = { muted: true, volume: 0.25, reducedMotion: true }
    applyGameCommand(state, { type: 'runProgram' })
    run(state, 12_000)
    saveGame(state, storage)
    const loaded = loadGame(storage)
    expect(loaded).not.toBeNull()
    run(state, 8_000)
    run(loaded!, 8_000)
    expect(loaded).toEqual(state)
    expect(loadSettings(storage)).toEqual(state.settings)
    expect(values.get('xenoflow.v1.save')).toBe('preserve-me')
  })

  it('enforces progressive world API unlocks inside the simulation boundary', () => {
    const source = 'value = need("gel_refinery", XENOGRAIN)'
    const state = createInitialState(source)
    applyGameCommand(state, { type: 'runProgram' })
    run(state, 100)
    expect(state.runtime.mode).toBe('error')
    expect(state.runtime.lastError).toContain('阶段 4')

    state.mission.phase = 4
    applyGameCommand(state, { type: 'loadProgram', source })
    applyGameCommand(state, { type: 'runProgram' })
    run(state, 100)
    expect(state.runtime.usedSensors).toContain('need')
    expect(state.runtime.lastError).toBeNull()
  })

  it('layout changes independently reduce drone transport distance', () => {
    const original = operationalState()
    const compact = operationalState()
    applyGameCommand(compact, { type: 'moveEntity', entityId: 'gel_input', x: 8, y: 4 })
    applyGameCommand(compact, { type: 'moveEntity', entityId: 'fiber_input', x: 8, y: 10 })
    const originalResult = runBenchmark(original, LOOP_PROGRAM)
    const compactResult = runBenchmark(compact, LOOP_PROGRAM)
    expect(compactResult.xenograinDistancePerUnit).toBeLessThan(originalResult.xenograinDistancePerUnit)
    expect(compactResult.coresPerMinute).toBeGreaterThanOrEqual(originalResult.coresPerMinute)
  })

  it('supports at least three distinct demand-driven winning programs', () => {
    for (const source of [LOOP_PROGRAM, FUNCTIONAL_PROGRAM, PRIORITY_PROGRAM]) {
      const state = operationalState()
      state.mission.phase = 5
      applyGameCommand(state, { type: 'loadProgram', source })
      applyGameCommand(state, { type: 'runProgram' })
      run(state, 480_000)
      expect(state.runtime.usedSensors, source).toContain('need')
      expect(state.metrics.coresDelivered, source).toBeGreaterThanOrEqual(6)
      expect(state.mission.sandboxUnlocked, source).toBe(true)
    }
  })

  it('keeps the factory inert until the player installs both input Inserters', () => {
    const state = createInitialState()
    state.mission.phase = 3
    state.entities.find((candidate) => candidate.id === 'gel_input')!.outputs.xenograin = 4
    state.entities.find((candidate) => candidate.id === 'fiber_input')!.outputs.xenograin = 2
    run(state, 10_000)
    expect(state.mission.completedObjectives).not.toContain('first-gel')
    expect(state.mission.completedObjectives).not.toContain('first-fiber')
    applyGameCommand(state, { type: 'build', kind: 'inserter', x: 11, y: 6 })
    applyGameCommand(state, { type: 'build', kind: 'inserter', x: 11, y: 11 })
    run(state, 12_000)
    expect(state.mission.completedObjectives).toEqual(expect.arrayContaining(['first-gel', 'first-fiber']))
  })

  it('does not accept a fixed patrol as demand-driven scheduling', () => {
    const state = operationalState()
    state.metrics.coresDelivered = 1
    applyGameCommand(state, { type: 'loadProgram', source: BASELINE_PROGRAM })
    applyGameCommand(state, { type: 'runProgram' })
    run(state, 4_000)
    expect(state.runtime.instructionCount).toBeGreaterThan(5)
    expect(state.mission.phase).toBe(4)

    applyGameCommand(state, { type: 'loadProgram', source: LOOP_PROGRAM })
    applyGameCommand(state, { type: 'runProgram' })
    run(state, 30_000)
    expect(state.runtime.usedSensors).toContain('need')
    expect(state.mission.phase).toBe(5)
  })

  it('cannot bypass the final challenge by switching back to fixed patrol', () => {
    const state = operationalState()
    state.mission.phase = 5
    state.metrics.coresDelivered = 12
    state.metrics.coreProductionTimes = [0, 10_000, 20_000, 30_000, 40_000, 50_000]
    state.drone.loadedDistance = 100
    state.drone.emptyDistance = 10
    applyGameCommand(state, { type: 'loadProgram', source: BASELINE_PROGRAM })
    applyGameCommand(state, { type: 'runProgram' })
    run(state, 120_000)
    expect(state.runtime.usedSensors).not.toContain('need')
    expect(state.mission.stabilityMs).toBe(0)
    expect(state.mission.sandboxUnlocked).toBe(false)
  })

  it('unlocks Sector 01 Sandbox only after the full stability gate', () => {
    const state = operationalState()
    applyGameCommand(state, { type: 'loadProgram', source: LOOP_PROGRAM })
    applyGameCommand(state, { type: 'runProgram' })
    run(state, 480_000)
    const totalDistance = state.drone.emptyDistance + state.drone.loadedDistance
    expect(state.metrics.coresDelivered).toBeGreaterThanOrEqual(6)
    expect((state.drone.emptyDistance / totalDistance) * 100).toBeLessThan(35)
    expect(state.power.stability).toBeGreaterThanOrEqual(90)
    expect(state.mission.sandboxUnlocked).toBe(true)
    expect(state.mission.phase).toBe(6)
  })

  it('advances every deterministic tick with 300 belts and 600 moving items', () => {
    const state = createInitialState()
    const template = state.entities.find((candidate) => candidate.kind === 'belt')!
    for (let index = 0; index < 300; index += 1) {
      state.entities.push({
        ...template,
        inputs: { ...template.inputs },
        outputs: { ...template.outputs },
        inputCapacity: { ...template.inputCapacity },
        outputCapacity: { ...template.outputCapacity },
        id: `stress-belt-${index}`,
        name: `stress-belt-${index}`,
        x: index % 30,
        y: 20 + Math.floor(index / 30),
        targetId: undefined,
        beltItems: [
          { id: 10_000 + index * 2, item: 'gel', lane: 0, progress: 0.1 },
          { id: 10_001 + index * 2, item: 'biofiber', lane: 1, progress: 0.2 },
        ],
      })
    }
    state.paused = false
    const engine = new XenoFlowEngine(state)
    engine.dispatch({ type: 'advance', elapsedMs: 10_000 })
    expect(engine.getState().tick).toBe(100)
    expect(state.entities.filter((candidate) => candidate.id.startsWith('stress-belt-')).reduce((total, belt) => total + (belt.beltItems?.length ?? 0), 0)).toBe(600)
    const rendered = createRenderSnapshot(state).entities.filter((candidate) => candidate.id.startsWith('stress-belt-'))
    expect(rendered).toHaveLength(300)
    expect(rendered.reduce((total, belt) => total + (belt.beltItems?.length ?? 0), 0)).toBe(600)
  })
})
