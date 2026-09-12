import { describe, expect, it } from 'vitest'
import { DEFINITIONS, DEMO_BASELINE_PROGRAM, DEMO_SHORT_PROGRAM, FACTORY_FIXTURE, fixtureCost } from './config'
import { compileProgram, createDrone, findDronePath, stepDrone } from './drone'
import { deserializeState, serializeState } from './save'
import {
  analyze,
  applyDroneSource,
  buildFactoryFixture,
  createEntity,
  createScenario,
  demolishEntity,
  getPowerMultiplier,
  keepOptimizing,
  makeVictorySnapshot,
  placeEntity,
  rotateEntity,
  runFor,
  stepSimulation,
  totalItemsInState,
  tryDroneDrop,
} from './simulation'
import type { Entity, GameState, Orientation } from './types'

function activeNewState(): GameState {
  const state = createScenario('new')
  state.paused = false
  state.drone.paused = true
  return state
}

function add(state: GameState, kind: Entity['kind'], x: number, y: number, orientation: Orientation): Entity {
  const entity = createEntity(`t${state.nextEntityId++}`, kind, x, y, orientation)
  state.entities.push(entity)
  return entity
}

describe('deterministic transport', () => {
  it('does not duplicate or lose items under blockage and simultaneous claims', () => {
    const state = activeNewState()
    const west = add(state, 'belt', 0, 1, 0)
    const north = add(state, 'belt', 1, 0, 1)
    const target = add(state, 'belt', 1, 1, 0)
    west.output = 'water'; west.transit = 0
    north.output = 'crystite'; north.transit = 0
    const before = totalItemsInState(state)
    stepSimulation(state)
    expect(totalItemsInState(state)).toBe(before)
    expect(target.output).not.toBeNull()
    expect([west.output, north.output].filter(Boolean)).toHaveLength(1)
    stepSimulation(state)
    expect(totalItemsInState(state)).toBe(before)
    expect(target.transit).toBeCloseTo(0.9)
  })

  it('rotates claim priority and splitter outputs after successful transfers', () => {
    const state = activeNewState()
    const splitter = add(state, 'splitter', 2, 2, 0)
    const front = add(state, 'belt', 3, 2, 0)
    const right = add(state, 'belt', 2, 3, 1)
    splitter.output = 'water'; splitter.transit = 0
    stepSimulation(state)
    expect(front.output).toBe('water')
    expect(splitter.splitterNext).toBe(1)
    front.output = null
    splitter.output = 'crystite'; splitter.transit = 0
    stepSimulation(state)
    expect(right.output).toBe('crystite')
  })

  it('keeps newly arrived belt items for their full travel time', () => {
    const state = activeNewState()
    const first = add(state, 'belt', 0, 2, 0)
    const second = add(state, 'belt', 1, 2, 0)
    const third = add(state, 'belt', 2, 2, 0)
    first.output = 'water'; first.transit = 0
    stepSimulation(state)
    expect(second.output).toBe('water')
    expect(second.transit).toBe(1)
    for (let i = 0; i < 9; i += 1) stepSimulation(state)
    expect(second.output).toBe('water')
    expect(third.output).toBeNull()
    stepSimulation(state)
    expect(third.output).toBe('water')
  })
})

describe('recipes, demolition, and power', () => {
  it('reserves recipe inputs once and emits exactly one output at the configured time', () => {
    const state = activeNewState()
    const refinery = add(state, 'gelRefinery', 5, 5, 0)
    refinery.input = { xenograin: 2, water: 1 }
    for (let i = 0; i < 59; i += 1) stepSimulation(state)
    expect(refinery.batch).toEqual({ xenograin: 2, water: 1 })
    expect(refinery.input.xenograin).toBe(0)
    expect(refinery.output).toBeNull()
    stepSimulation(state)
    expect(refinery.output).toBe('gel')
    expect(refinery.batch).toBeNull()
    expect(state.stats.produced).toBe(1)
  })

  it('counts buffers and an unfinished reserved batch as discarded', () => {
    const state = activeNewState()
    const refinery = add(state, 'gelRefinery', 5, 5, 0)
    refinery.input = { xenograin: 2, water: 1 }
    stepSimulation(state)
    const result = demolishEntity(state, refinery.id)
    expect(result).toEqual({ ok: true, refund: 48, discarded: 3 })
    expect(state.stats.discarded).toBe(3)
  })

  it('rotates without losing buffers, output, or an in-progress batch', () => {
    const state = activeNewState()
    const refinery = add(state, 'gelRefinery', 5, 5, 0)
    refinery.input = { xenograin: 2, water: 1 }
    stepSimulation(state)
    const beforeItems = totalItemsInState(state)
    const batch = JSON.stringify(refinery.batch)
    expect(rotateEntity(state, refinery.id)).toBe(true)
    expect(refinery.orientation).toBe(1)
    expect(JSON.stringify(refinery.batch)).toBe(batch)
    expect(totalItemsInState(state)).toBe(beforeItems)
  })

  it('uses one global multiplier and gives equal results for equal simulated time at every UI speed', () => {
    const make = () => {
      const state = activeNewState()
      for (let index = 0; index < 5; index += 1) add(state, 'coreAssembler', index, 12, 0)
      return state
    }
    const state = make()
    expect(getPowerMultiplier(state)).toBeCloseTo(0.8)
    const snapshots = ([1, 2, 4] as const).map((speed) => {
      const candidate = make()
      candidate.speed = speed
      runFor(candidate, 10)
      return candidate.entities.map((entity) => entity.progress)
    })
    expect(snapshots[0]).toEqual(snapshots[1])
    expect(snapshots[1]).toEqual(snapshots[2])
  })

  it('does not advance while paused', () => {
    const state = createScenario('new')
    const before = serializeState(state)
    stepSimulation(state)
    expect(serializeState(state)).toBe(before)
    expect(placeEntity(state, 'crop', 3, 3, 0).ok).toBe(true)
    expect(applyDroneSource(state, 'WAIT 1').ok).toBe(true)
  })
})

describe('drone language and runtime', () => {
  it('reports syntax, ranges, nesting, and zero-time budget errors', () => {
    expect(() => compileProgram('FLY 1 2')).toThrow(/Line 1.*Unknown command/)
    expect(() => compileProgram('WAIT 0')).toThrow(/0.1 to 60/)
    expect(() => compileProgram('REPEAT 101\nEND')).toThrow(/1 to 100/)
    expect(() => compileProgram('LOOP\nLOOP\nLOOP\nLOOP\nLOOP\nWAIT 1\nEND\nEND\nEND\nEND\nEND')).toThrow(/nesting depth/)
    const drone = createDrone(`LOOP\n${'DROP 1 0\n'.repeat(65)}END`)
    drone.x = 0; drone.y = 0; drone.paused = false
    stepDrone(drone, 0.1, { entityAt: () => undefined, harvest: () => 'missing', drop: () => ({ status: 'invalid', reason: 'bad' }) })
    expect(drone.error).toMatch(/64 zero-time/)
  })

  it('uses deterministic N/E/S/W BFS and avoids rocks', () => {
    expect(findDronePath({ x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }])
    expect(findDronePath({ x: 6, y: 3 }, { x: 8, y: 3 })).toEqual([
      { x: 6, y: 2 }, { x: 7, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 3 },
    ])
  })

  it('skips full-cargo harvest, advances empty drop, waits on full compatible targets, and errors on incompatible targets', () => {
    const crop = createEntity('crop', 'crop', 0, 0, 0)
    crop.ripe = true
    const full = createDrone('HARVEST\nDROP 1 0')
    full.x = 0; full.y = 0; full.cargo = 4; full.paused = false
    const context = { entityAt: () => crop, harvest: () => 'harvested' as const, drop: () => ({ status: 'accepted' as const, amount: 4 }) }
    stepDrone(full, 0.1, context)
    expect(full.pc).toBe(2)
    expect(full.message).toMatch(/Cargo empty|Dropped/)

    const empty = createDrone('DROP 1 0')
    empty.x = 0; empty.y = 0; empty.paused = false
    stepDrone(empty, 0.1, { ...context, entityAt: () => createEntity('r', 'gelRefinery', 1, 0, 0) })
    expect(empty.pc).toBe(1)

    const state = activeNewState()
    const refinery = add(state, 'gelRefinery', 1, 0, 0)
    refinery.input.xenograin = 4
    state.drone.x = 0; state.drone.y = 0; state.drone.cargo = 1
    expect(tryDroneDrop(state, refinery, 1)).toEqual({ status: 'full' })
    const assembler = add(state, 'coreAssembler', 0, 1, 0)
    expect(tryDroneDrop(state, assembler, 1)).toMatchObject({ status: 'invalid' })
  })

  it('rejects a DROP from a machine output side even when its input is full', () => {
    const state = activeNewState()
    const refinery = add(state, 'gelRefinery', 1, 0, 2)
    refinery.input.xenograin = 4
    state.drone.x = 0; state.drone.y = 0; state.drone.cargo = 1
    expect(tryDroneDrop(state, refinery, 1)).toMatchObject({ status: 'invalid' })
  })
})

describe('save, scoring, and integration fixtures', () => {
  it('continues identically after save/load apart from explicit pause-on-load', () => {
    const direct = createScenario('demo')
    runFor(direct, 10)
    const loadedResult = deserializeState(serializeState(direct))
    expect(loadedResult.ok).toBe(true)
    if (!loadedResult.ok) return
    const resumed = loadedResult.state
    resumed.paused = false
    resumed.notice = null
    direct.paused = false
    runFor(direct, 10)
    runFor(resumed, 10)
    direct.paused = true
    resumed.paused = true
    expect(serializeState(resumed)).toBe(serializeState(direct))
  })

  it('handles score zero denominators and warm-up', () => {
    const state = createScenario('new')
    expect(analyze(state)).toMatchObject({ efficiency: 0, coreRate: 0, warmingUp: true, retention: 1 })
    state.stats.discarded = 5
    state.paused = false
    runFor(state, 15)
    const result = analyze(state)
    expect(Number.isFinite(result.efficiency)).toBe(true)
    expect(result.retention).toBe(0)
  })

  it('keeps the evidence-based drone route diagnosis visible beside repetitive belt blockage', () => {
    const state = createScenario('demo')
    state.simulatedTime = 60
    state.stats.slices = [{
      start: 0, end: 60, overloaded: false,
      machineStates: {}, shortages: {}, blocked: ['e6', 'e7', 'e8'],
      droneActivity: 'travel', delivered: 0,
    }]
    const result = analyze(state)
    expect(result.diagnoses).toHaveLength(2)
    expect(result.diagnoses.some((diagnosis) => diagnosis.text.includes('Drone spent 100%'))).toBe(true)
    expect(result.diagnoses.filter((diagnosis) => diagnosis.text.includes('Belt'))).toHaveLength(1)
  })

  it('uses the documented final-score arithmetic exactly', () => {
    const state = createScenario('new')
    state.simulatedTime = 60
    state.credits = 100
    state.stats.produced = 10
    state.stats.discarded = 2
    state.stats.delivered = 6
    state.stats.slices = [{ start: 0, end: 60, overloaded: false, machineStates: {}, shortages: {}, blocked: [], droneActivity: 'travel', delivered: 1 }]
    const result = makeVictorySnapshot(state)
    expect(result.efficiency).toBeCloseTo(49)
    expect(result.score).toBe(8060)
  })

  it('rejects corrupt and unsupported saves without deleting them', () => {
    expect(deserializeState('{bad')).toMatchObject({ ok: false, kind: 'corrupt' })
    expect(deserializeState('{"version":2}')).toMatchObject({ ok: false, kind: 'unsupported' })
    expect(deserializeState('{"version":1,"scenario":"new"}')).toMatchObject({ ok: false, kind: 'corrupt' })
  })

  it('builds a no-free-item New Factory fixture within 500 credits and reaches six Cores within 360 seconds', () => {
    const state = createScenario('new')
    expect(state.entities).toHaveLength(1)
    expect(state.stats.initialItems).toBe(0)
    expect(fixtureCost()).toBeLessThanOrEqual(500)
    buildFactoryFixture(state)
    expect(state.credits).toBe(500 - fixtureCost())
    expect(applyDroneSource(state, DEMO_SHORT_PROGRAM).ok).toBe(true)
    runFor(state, 360)
    expect(state.stats.delivered).toBeGreaterThanOrEqual(6)
    expect(state.victory?.completionSeconds).toBeLessThanOrEqual(360)
  })

  it('delivers the demo first Core within 30 seconds and both programs finish', () => {
    for (const source of [DEMO_BASELINE_PROGRAM, DEMO_SHORT_PROGRAM]) {
      const state = createScenario('demo')
      expect(applyDroneSource(state, source).ok).toBe(true)
      runFor(state, 30)
      expect(state.stats.delivered).toBeGreaterThanOrEqual(1)
      runFor(state, 1200)
      expect(state.stats.delivered).toBeGreaterThanOrEqual(6)
    }
  })

  it('shows measured route improvement from identical states and intervals', () => {
    const baseline = createScenario('demo')
    const shorter = createScenario('demo')
    applyDroneSource(baseline, DEMO_BASELINE_PROGRAM)
    applyDroneSource(shorter, DEMO_SHORT_PROGRAM)
    runFor(baseline, 60)
    runFor(shorter, 60)
    baseline.stats.slices = []; shorter.stats.slices = []
    const beforeBaseDelivered = baseline.stats.delivered
    const beforeShortDelivered = shorter.stats.delivered
    const beforeBaseDistance = baseline.drone.distance
    const beforeShortDistance = shorter.drone.distance
    runFor(baseline, 180)
    runFor(shorter, 180)
    const baselineDelivered = baseline.stats.delivered - beforeBaseDelivered
    const shorterDelivered = shorter.stats.delivered - beforeShortDelivered
    const baselineDistance = baseline.drone.distance - beforeBaseDistance
    const shorterDistance = shorter.drone.distance - beforeShortDistance
    expect(shorterDelivered).toBeGreaterThan(baselineDelivered)
    expect(shorterDistance / 180).toBeLessThan(baselineDistance / 180)
  })

  it('central recipe arithmetic remains exactly 5 grain, 2 water, and 2 crystite per Core', () => {
    const gel = DEFINITIONS.gelRefinery.recipe!
    const fiber = DEFINITIONS.fiberMill.recipe!
    const assembler = DEFINITIONS.coreAssembler.recipe!
    expect((gel.inputs.xenograin ?? 0) * (assembler.inputs.gel ?? 0) + (fiber.inputs.xenograin ?? 0) * (assembler.inputs.biofiber ?? 0)).toBe(5)
    expect((gel.inputs.water ?? 0) * (assembler.inputs.gel ?? 0)).toBe(2)
    expect((fiber.inputs.crystite ?? 0) * (assembler.inputs.biofiber ?? 0)).toBe(2)
    expect(FACTORY_FIXTURE.length).toBeGreaterThan(20)
  })
})
