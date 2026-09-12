import { describe, expect, it } from 'vitest'
import { BASELINE_PROGRAM, LOOP_PROGRAM, SIM_STEP_MS, STARTER_PROGRAM } from './config'
import { runBenchmark } from './benchmark'
import { loadGame, saveGame } from './save'
import { advanceSimulation, applyGameCommand, cloneState, createInitialState } from './simulation'

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

  it('produces identical snapshots from the same state and program', () => {
    const first = createInitialState(LOOP_PROGRAM)
    const second = cloneState(first)
    applyGameCommand(first, { type: 'runProgram' })
    applyGameCommand(second, { type: 'runProgram' })
    run(first, 30_000)
    run(second, 30_000)
    expect(second).toEqual(first)
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

  it('keeps save/load deterministic in the v2 namespace', () => {
    const values = new Map<string, string>([['xenoflow.v1.save', 'preserve-me']])
    const storage = {
      setItem(key: string, value: string) { values.set(key, value) },
      getItem(key: string) { return values.get(key) ?? null },
    }
    const state = createInitialState(LOOP_PROGRAM)
    applyGameCommand(state, { type: 'runProgram' })
    run(state, 12_000)
    saveGame(state, storage)
    const loaded = loadGame(storage)
    expect(loaded).not.toBeNull()
    run(state, 8_000)
    run(loaded!, 8_000)
    expect(loaded).toEqual(state)
    expect(values.get('xenoflow.v1.save')).toBe('preserve-me')
  })

  it('layout changes independently reduce drone transport distance', () => {
    const original = operationalState()
    const compact = operationalState()
    applyGameCommand(compact, { type: 'moveEntity', entityId: 'gel_input', x: 8, y: 4 })
    applyGameCommand(compact, { type: 'moveEntity', entityId: 'fiber_input', x: 8, y: 10 })
    const originalResult = runBenchmark(original, LOOP_PROGRAM)
    const compactResult = runBenchmark(compact, LOOP_PROGRAM)
    expect(compactResult.xenograinDistancePerUnit).toBeLessThan(originalResult.xenograinDistancePerUnit)
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
    run(state, 10_000)
    expect(state.tick).toBe(100)
    expect(state.entities.filter((candidate) => candidate.id.startsWith('stress-belt-')).reduce((total, belt) => total + (belt.beltItems?.length ?? 0), 0)).toBe(600)
  })
})
