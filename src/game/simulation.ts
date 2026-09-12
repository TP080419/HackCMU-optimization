import {
  BASE_POWER_CAPACITY,
  DEFINITIONS,
  DEMO_BASELINE_PROGRAM,
  DIRECTION_VECTORS,
  FACTORY_FIXTURE,
  ITEM_LABELS,
  MAP_HEIGHT,
  MAP_WIDTH,
  NEW_FACTORY_STARTER_PROGRAM,
  STARTING_CREDITS,
  STEP_SECONDS,
  TERRAIN,
  VICTORY_CORES,
  fixtureCost,
  isPointIn,
} from './config'
import { createDrone, installProgram, stepDrone } from './drone'
import type {
  AnalysisSnapshot,
  BaselineMetric,
  BuildableKind,
  DroneActivity,
  Entity,
  EntityKind,
  GameState,
  ItemType,
  MachineStatus,
  MetricSlice,
  Orientation,
  Point,
  ScenarioMode,
  VictorySnapshot,
} from './types'

const EPSILON = 0.000001

function normalize(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

export function createEntity(id: string, kind: EntityKind, x: number, y: number, orientation: Orientation): Entity {
  return {
    id,
    kind,
    x,
    y,
    orientation,
    input: {},
    output: null,
    items: [],
    progress: 0,
    batch: null,
    ripe: false,
    transit: 0,
    splitterNext: 0,
  }
}

export function createScenario(scenario: ScenarioMode): GameState {
  const uplink = createEntity('uplink', 'uplink', TERRAIN.uplink.x, TERRAIN.uplink.y, 0)
  uplink.protected = true
  const state: GameState = {
    version: 1,
    scenario,
    entities: [uplink],
    credits: STARTING_CREDITS,
    powerCapacity: BASE_POWER_CAPACITY,
    simulatedTime: 0,
    tick: 0,
    nextEntityId: 1,
    paused: true,
    speed: 1,
    arbitration: {},
    drone: createDrone(scenario === 'demo' ? DEMO_BASELINE_PROGRAM : NEW_FACTORY_STARTER_PROGRAM),
    stats: {
      produced: 0,
      producedBy: { xenograin: 0, water: 0, crystite: 0, gel: 0, biofiber: 0, core: 0 },
      harvested: 0,
      initialItems: 0,
      discarded: 0,
      delivered: 0,
      lastDeliveryAt: null,
      slices: [],
    },
    victory: null,
    victoryAcknowledged: false,
    baseline: null,
    notice: null,
    settings: { showCoordinates: false, objectivesCollapsed: false },
  }
  if (scenario === 'demo') {
    for (const placement of FACTORY_FIXTURE) {
      const entity = createEntity(`e${state.nextEntityId++}`, placement.kind, placement.x, placement.y, placement.orientation)
      state.entities.push(entity)
    }
    state.credits -= fixtureCost()
    const assembler = state.entities.find((entity) => entity.kind === 'coreAssembler')
    if (assembler) {
      assembler.input.gel = 2
      assembler.input.biofiber = 1
      state.stats.initialItems = 3
    }
    state.drone.paused = false
    state.paused = false
  }
  return state
}

export function entityAt(state: GameState, x: number, y: number): Entity | undefined {
  return state.entities.find((entity) => entity.x === x && entity.y === y)
}

export function getPowerDemand(state: GameState): number {
  return state.entities.reduce((sum, entity) => sum + (entity.kind === 'uplink' ? 0 : DEFINITIONS[entity.kind].power), 0)
}

export function getPowerCapacity(state: GameState): number {
  return BASE_POWER_CAPACITY + state.entities.filter((entity) => entity.kind === 'solarPylon').length * 60
}

export function getPowerMultiplier(state: GameState): number {
  const demand = getPowerDemand(state)
  const capacity = getPowerCapacity(state)
  return demand === 0 ? 1 : Math.min(1, capacity / demand)
}

export function placementProblem(state: GameState, kind: BuildableKind, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return 'Out of bounds.'
  if (entityAt(state, x, y)) return 'Tile is occupied.'
  if (isPointIn(TERRAIN.rocks, x, y)) return 'Rock terrain cannot be built on.'
  const definition = DEFINITIONS[kind]
  if (state.credits < definition.cost) return `Need ${definition.cost - state.credits} more credits.`
  const onSpring = TERRAIN.spring.x === x && TERRAIN.spring.y === y
  const onVent = TERRAIN.vent.x === x && TERRAIN.vent.y === y
  const onFertile = isPointIn(TERRAIN.fertile, x, y)
  if (kind === 'waterExtractor' && !onSpring) return 'Water Extractor requires the Hydro Spring.'
  if (kind === 'crystiteDrill' && !onVent) return 'Crystite Drill requires the Crystite Vent.'
  if (kind === 'crop' && !onFertile) return 'Crop Plot requires fertile ground.'
  if (kind !== 'waterExtractor' && onSpring) return 'Hydro Spring is reserved for an extractor.'
  if (kind !== 'crystiteDrill' && onVent) return 'Crystite Vent is reserved for a drill.'
  return null
}

export function placeEntity(state: GameState, kind: BuildableKind, x: number, y: number, orientation: Orientation): { ok: true; entity: Entity } | { ok: false; reason: string } {
  const problem = placementProblem(state, kind, x, y)
  if (problem) return { ok: false, reason: problem }
  const entity = createEntity(`e${state.nextEntityId++}`, kind, x, y, orientation)
  state.entities.push(entity)
  state.credits -= DEFINITIONS[kind].cost
  state.powerCapacity = getPowerCapacity(state)
  return { ok: true, entity }
}

function countContained(entity: Entity): number {
  const inputs = Object.values(entity.input).reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const reserved = entity.batch ? Object.values(entity.batch).reduce<number>((sum, value) => sum + (value ?? 0), 0) : 0
  return inputs + reserved + entity.items.length + (entity.output ? 1 : 0) + (entity.ripe ? 1 : 0)
}

export function demolishEntity(state: GameState, entityId: string): { ok: true; refund: number; discarded: number } | { ok: false; reason: string } {
  const index = state.entities.findIndex((entity) => entity.id === entityId)
  if (index < 0) return { ok: false, reason: 'Entity no longer exists.' }
  const entity = state.entities[index]
  if (entity.protected || entity.kind === 'uplink') return { ok: false, reason: 'Core Uplink is protected.' }
  const definition = DEFINITIONS[entity.kind]
  const refund = entity.kind === 'belt' ? 1 : Math.floor(definition.cost * 0.8)
  const discarded = countContained(entity)
  state.entities.splice(index, 1)
  state.credits += refund
  state.stats.discarded += discarded
  state.powerCapacity = getPowerCapacity(state)
  return { ok: true, refund, discarded }
}

export function rotateEntity(state: GameState, entityId: string): boolean {
  const entity = state.entities.find((candidate) => candidate.id === entityId)
  if (!entity || entity.kind === 'uplink') return false
  entity.orientation = ((entity.orientation + 1) % 4) as Orientation
  return true
}

function outputPoint(entity: Entity, turnRight = false): Point {
  const orientation = turnRight ? ((entity.orientation + 1) % 4) as Orientation : entity.orientation
  const vector = DIRECTION_VECTORS[orientation]
  return { x: entity.x + vector.x, y: entity.y + vector.y }
}

function isReceivingSide(target: Entity, source: Point): boolean {
  if (target.kind === 'uplink') return true
  if (target.kind === 'crop' || target.kind === 'waterExtractor' || target.kind === 'crystiteDrill' || target.kind === 'solarPylon') return false
  const facing = DIRECTION_VECTORS[target.orientation]
  if (target.kind === 'splitter') return source.x === target.x - facing.x && source.y === target.y - facing.y
  return !(source.x === target.x + facing.x && source.y === target.y + facing.y)
}

function recipeInputCapacity(entity: Entity, item: ItemType): number {
  if (entity.kind === 'uplink') return item === 'core' ? Number.POSITIVE_INFINITY : 0
  if (entity.kind === 'belt' || entity.kind === 'splitter') return entity.output === null ? 1 : 0
  if (entity.kind === 'crate') return Math.max(0, 20 - entity.items.length)
  if (entity.kind === 'crop' || entity.kind === 'waterExtractor' || entity.kind === 'crystiteDrill' || entity.kind === 'solarPylon') return 0
  const amountPerBatch = DEFINITIONS[entity.kind].recipe?.inputs[item] ?? 0
  if (amountPerBatch === 0) return 0
  return Math.max(0, amountPerBatch * 2 - (entity.input[item] ?? 0))
}

function receivingCapacity(target: Entity, item: ItemType, source: Point): number {
  if (!isReceivingSide(target, source)) return 0
  return recipeInputCapacity(target, item)
}

function receiveItem(state: GameState, target: Entity, item: ItemType): void {
  if (target.kind === 'uplink') {
    state.stats.delivered += 1
    state.stats.lastDeliveryAt = state.simulatedTime
    return
  }
  if (target.kind === 'belt' || target.kind === 'splitter') {
    target.output = item
    target.transit = 1
    return
  }
  if (target.kind === 'crate') {
    target.items.push(item)
    return
  }
  target.input[item] = (target.input[item] ?? 0) + 1
}

export function tryDroneDrop(state: GameState, target: Entity, requested: number): { status: 'accepted'; amount: number } | { status: 'full' } | { status: 'invalid'; reason: string } {
  if (!isReceivingSide(target, { x: state.drone.x, y: state.drone.y })) {
    return { status: 'invalid', reason: `The drone is beside ${target.kind}'s output side; use another side.` }
  }
  const capacity = receivingCapacity(target, 'xenograin', { x: state.drone.x, y: state.drone.y })
  if (capacity <= 0) {
    const rawCapacity = recipeInputCapacity(target, 'xenograin')
    if (rawCapacity <= 0 && (target.kind === 'gelRefinery' || target.kind === 'fiberMill')) return { status: 'full' }
    if (rawCapacity <= 0) return { status: 'invalid', reason: `${target.kind} does not accept Xenograin.` }
    return { status: 'full' }
  }
  const amount = Math.min(capacity, requested)
  for (let index = 0; index < amount; index += 1) receiveItem(state, target, 'xenograin')
  return { status: 'accepted', amount }
}

function canStartRecipe(entity: Entity): boolean {
  if (entity.kind === 'uplink' || entity.kind === 'belt' || entity.kind === 'splitter' || entity.kind === 'crate' || entity.kind === 'crop' || entity.kind === 'waterExtractor' || entity.kind === 'crystiteDrill' || entity.kind === 'solarPylon') return false
  const recipe = DEFINITIONS[entity.kind].recipe!
  return Object.entries(recipe.inputs).every(([item, needed]) => (entity.input[item as ItemType] ?? 0) >= (needed ?? 0))
}

function missingInput(entity: Entity): ItemType | null {
  if (entity.kind === 'uplink' || entity.kind === 'belt' || entity.kind === 'splitter' || entity.kind === 'crate' || entity.kind === 'crop' || entity.kind === 'waterExtractor' || entity.kind === 'crystiteDrill' || entity.kind === 'solarPylon') return null
  const recipe = DEFINITIONS[entity.kind].recipe!
  for (const [item, needed] of Object.entries(recipe.inputs)) {
    if ((entity.input[item as ItemType] ?? 0) < (needed ?? 0)) return item as ItemType
  }
  return null
}

function updateProduction(state: GameState, dt: number): void {
  const multiplier = getPowerMultiplier(state)
  for (const entity of state.entities) {
    if (entity.kind === 'uplink' || entity.kind === 'belt' || entity.kind === 'splitter' || entity.kind === 'crate' || entity.kind === 'solarPylon') continue
    const definition = DEFINITIONS[entity.kind]
    if (entity.kind === 'crop') {
      if (!entity.ripe && multiplier > 0) {
        entity.progress = normalize(entity.progress + dt * multiplier)
        if (entity.progress + EPSILON >= definition.cycleSeconds!) {
          entity.progress = definition.cycleSeconds!
          entity.ripe = true
          state.stats.produced += 1
          state.stats.producedBy.xenograin += 1
        }
      }
      continue
    }
    if (entity.kind === 'waterExtractor' || entity.kind === 'crystiteDrill') {
      if (!entity.output && multiplier > 0) {
        entity.progress = normalize(entity.progress + dt * multiplier)
        if (entity.progress + EPSILON >= definition.cycleSeconds!) {
          entity.progress = 0
          entity.output = definition.produces!
          state.stats.produced += 1
          state.stats.producedBy[definition.produces!] += 1
        }
      }
      continue
    }
    const recipe = definition.recipe!
    if (!entity.batch && !entity.output && canStartRecipe(entity)) {
      entity.batch = { ...recipe.inputs }
      for (const [item, needed] of Object.entries(recipe.inputs)) {
        entity.input[item as ItemType] = (entity.input[item as ItemType] ?? 0) - (needed ?? 0)
      }
      entity.progress = 0
    }
    if (entity.batch && multiplier > 0) {
      entity.progress = normalize(entity.progress + dt * multiplier)
      if (entity.progress + EPSILON >= recipe.seconds && !entity.output) {
        entity.output = recipe.output
        entity.batch = null
        entity.progress = 0
        state.stats.produced += 1
        state.stats.producedBy[recipe.output] += 1
      }
    }
  }
}

export function getMachineStatus(state: GameState, entity: Entity): { status: MachineStatus; missing?: ItemType } {
  if (entity.kind === 'uplink' || entity.kind === 'belt' || entity.kind === 'splitter' || entity.kind === 'crate' || entity.kind === 'solarPylon') return { status: 'READY' }
  const multiplier = getPowerMultiplier(state)
  if (DEFINITIONS[entity.kind].power > 0 && multiplier <= 0) return { status: 'NO POWER' }
  if (entity.kind === 'crop') return { status: entity.ripe ? 'READY' : 'WORKING' }
  if (entity.kind === 'waterExtractor' || entity.kind === 'crystiteDrill') return { status: entity.output ? 'BLOCKED' : 'WORKING' }
  if (entity.output) return { status: 'BLOCKED' }
  if (entity.batch) return { status: 'WORKING' }
  const missing = missingInput(entity)
  return missing ? { status: 'STARVED', missing } : { status: 'READY' }
}

interface TransferIntent {
  source: Entity
  target: Entity
  item: ItemType
  splitterChoice?: 0 | 1
}

function sourceItem(entity: Entity): ItemType | null {
  if (entity.kind === 'crate') return entity.items[0] ?? null
  return entity.output
}

function sourceReady(entity: Entity): boolean {
  if (entity.kind === 'belt' || entity.kind === 'splitter') return entity.output !== null && entity.transit <= EPSILON
  if (entity.kind === 'crate') return entity.items.length > 0
  return entity.output !== null
}

function removeSourceItem(entity: Entity): void {
  if (entity.kind === 'crate') entity.items.shift()
  else entity.output = null
}

function updateTransit(state: GameState, dt: number): void {
  for (const entity of state.entities) {
    if ((entity.kind === 'belt' || entity.kind === 'splitter') && entity.output && entity.transit > 0) {
      entity.transit = normalize(Math.max(0, entity.transit - dt))
    }
  }
}

function resolveTransfers(state: GameState): string[] {
  const intents: TransferIntent[] = []
  const blocked = new Set<string>()
  const sources = state.entities.filter(sourceReady).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  for (const source of sources) {
    const item = sourceItem(source)
    if (!item || source.kind === 'uplink' || source.kind === 'crop' || source.kind === 'solarPylon') continue
    const candidates: Array<{ point: Point; choice?: 0 | 1 }> = source.kind === 'splitter'
      ? [
          { point: outputPoint(source, source.splitterNext === 1), choice: source.splitterNext },
          { point: outputPoint(source, source.splitterNext === 0), choice: (1 - source.splitterNext) as 0 | 1 },
        ]
      : [{ point: outputPoint(source) }]
    let intent: TransferIntent | null = null
    for (const candidate of candidates) {
      const target = entityAt(state, candidate.point.x, candidate.point.y)
      if (target && receivingCapacity(target, item, { x: source.x, y: source.y }) > 0) {
        intent = { source, target, item, splitterChoice: candidate.choice }
        break
      }
    }
    if (intent) intents.push(intent)
    else blocked.add(source.id)
  }

  const grouped = new Map<string, TransferIntent[]>()
  for (const intent of intents) {
    const group = grouped.get(intent.target.id) ?? []
    group.push(intent)
    grouped.set(intent.target.id, group)
  }
  for (const [targetId, claims] of grouped) {
    claims.sort((a, b) => a.source.id.localeCompare(b.source.id, undefined, { numeric: true }))
    const cursor = state.arbitration[targetId] ?? 0
    const winnerIndex = cursor % claims.length
    const winner = claims[winnerIndex]
    state.arbitration[targetId] = (winnerIndex + 1) % claims.length
    for (let index = 0; index < claims.length; index += 1) {
      if (index !== winnerIndex) blocked.add(claims[index].source.id)
    }
    removeSourceItem(winner.source)
    receiveItem(state, winner.target, winner.item)
    if (winner.source.kind === 'splitter') winner.source.splitterNext = (1 - (winner.splitterChoice ?? winner.source.splitterNext)) as 0 | 1
  }
  return [...blocked]
}

function createMetricSlice(state: GameState, start: number, end: number, activity: DroneActivity, blocked: string[], deliveredBefore: number): MetricSlice {
  const machineStates: Record<string, MachineStatus> = {}
  const shortages: Record<string, string> = {}
  for (const entity of state.entities) {
    if (!['crop', 'waterExtractor', 'crystiteDrill', 'gelRefinery', 'fiberMill', 'coreAssembler'].includes(entity.kind)) continue
    const status = getMachineStatus(state, entity)
    machineStates[entity.id] = status.status
    if (status.missing) shortages[entity.id] = status.missing
  }
  return {
    start,
    end,
    overloaded: getPowerDemand(state) > getPowerCapacity(state),
    machineStates,
    shortages,
    blocked,
    droneActivity: activity,
    delivered: state.stats.delivered - deliveredBefore,
  }
}

function trimMetrics(state: GameState): void {
  const cutoff = state.simulatedTime - 60
  while (state.stats.slices.length > 0 && state.stats.slices[0].end <= cutoff + EPSILON) state.stats.slices.shift()
}

function sameRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key])
}

function appendMetricSlice(state: GameState, slice: MetricSlice): void {
  const previous = state.stats.slices.at(-1)
  if (previous
    && previous.delivered === 0
    && slice.delivered === 0
    && previous.overloaded === slice.overloaded
    && previous.droneActivity === slice.droneActivity
    && sameRecord(previous.machineStates, slice.machineStates)
    && sameRecord(previous.shortages, slice.shortages)
    && previous.blocked.length === slice.blocked.length
    && previous.blocked.every((id, index) => id === slice.blocked[index])) {
    previous.end = slice.end
    return
  }
  state.stats.slices.push(slice)
}

export function stepSimulation(state: GameState, dt = STEP_SECONDS): void {
  if (state.paused || state.victory && !state.victoryAcknowledged) return
  const start = state.simulatedTime
  const deliveredBefore = state.stats.delivered
  state.tick += 1
  state.powerCapacity = getPowerCapacity(state)
  updateTransit(state, dt)
  updateProduction(state, dt)
  const activity = stepDrone(state.drone, dt, {
    entityAt: (x, y) => entityAt(state, x, y),
    harvest: (entity) => {
      if (entity.kind !== 'crop') return 'missing'
      if (!entity.ripe) return 'unripe'
      entity.ripe = false
      entity.progress = 0
      state.stats.harvested += 1
      return 'harvested'
    },
    drop: (entity, requested) => tryDroneDrop(state, entity, requested),
  })
  const blocked = resolveTransfers(state)
  state.simulatedTime = normalize(state.simulatedTime + dt)
  appendMetricSlice(state, createMetricSlice(state, start, state.simulatedTime, activity, blocked, deliveredBefore))
  trimMetrics(state)
  if (state.stats.delivered >= VICTORY_CORES && !state.victory) {
    state.victory = makeVictorySnapshot(state)
    state.paused = true
  }
}

export function runFor(state: GameState, seconds: number): void {
  const steps = Math.round(seconds / STEP_SECONDS)
  const wasPaused = state.paused
  state.paused = false
  for (let index = 0; index < steps; index += 1) {
    stepSimulation(state)
    if (state.victory && !state.victoryAcknowledged) keepOptimizing(state)
  }
  if (wasPaused) state.paused = true
}

export function analyze(state: GameState): AnalysisSnapshot {
  const elapsedWindow = Math.min(60, state.simulatedTime)
  if (elapsedWindow <= EPSILON) {
    return { elapsedWindow: 0, coreRate: 0, throughput: 0, powerStability: 1, retention: 1, efficiency: 0, warmingUp: true, travelFraction: 0, machineDurations: {}, diagnoses: [] }
  }
  const slices = state.stats.slices
  const cutoff = Math.max(0, state.simulatedTime - 60)
  const durationOf = (slice: MetricSlice) => Math.max(0, slice.end - Math.max(slice.start, cutoff))
  const delivered = slices.reduce((sum, slice) => sum + slice.delivered, 0)
  const overloaded = slices.reduce((sum, slice) => sum + (slice.overloaded ? durationOf(slice) : 0), 0)
  const coreRate = delivered * 60 / elapsedWindow
  const throughput = Math.max(0, Math.min(1, coreRate / 2))
  const powerStability = 1 - overloaded / elapsedWindow
  const retention = Math.max(0, Math.min(1, 1 - state.stats.discarded / Math.max(1, state.stats.initialItems + state.stats.produced)))
  const efficiency = 100 * throughput * (0.8 + 0.1 * powerStability + 0.1 * retention)
  const travel = slices.reduce((sum, slice) => sum + (slice.droneActivity === 'travel' ? durationOf(slice) : 0), 0)
  const machineDurations: Record<string, Record<MachineStatus, number>> = {}
  const shortageDurations = new Map<string, number>()
  const blockedDurations = new Map<string, number>()
  for (const slice of slices) {
    const duration = durationOf(slice)
    for (const [entityId, status] of Object.entries(slice.machineStates)) {
      const durations = machineDurations[entityId] ?? { WORKING: 0, STARVED: 0, BLOCKED: 0, 'NO POWER': 0, READY: 0 }
      durations[status] += duration
      machineDurations[entityId] = durations
    }
    for (const [entityId, item] of Object.entries(slice.shortages)) {
      const key = `${entityId}|${item}`
      shortageDurations.set(key, (shortageDurations.get(key) ?? 0) + duration)
    }
    for (const entityId of slice.blocked) blockedDurations.set(entityId, (blockedDurations.get(entityId) ?? 0) + duration)
  }
  const diagnoses: AnalysisSnapshot['diagnoses'] = []
  if (elapsedWindow >= 15) {
    const shortageCandidates: Array<{ entityId?: string; text: string; seconds: number }> = []
    const blockedCandidates: Array<{ entityId?: string; text: string; seconds: number }> = []
    for (const [key, seconds] of shortageDurations) {
      const [entityId, item] = key.split('|')
      const entity = state.entities.find((candidate) => candidate.id === entityId)
      if (entity && seconds >= 1) shortageCandidates.push({ entityId, seconds, text: `${DEFINITIONS[entity.kind as BuildableKind]?.name ?? entity.kind} lacked ${ITEM_LABELS[item as ItemType]} for ${Math.round(seconds)} of the last ${Math.round(elapsedWindow)} seconds.` })
    }
    for (const [entityId, seconds] of blockedDurations) {
      const entity = state.entities.find((candidate) => candidate.id === entityId)
      if (entity && seconds >= 2) blockedCandidates.push({ entityId, seconds, text: `${DEFINITIONS[entity.kind as BuildableKind]?.name ?? entity.kind} could not transfer output for ${Math.round(seconds)} seconds.` })
    }
    shortageCandidates.sort((a, b) => b.seconds - a.seconds)
    blockedCandidates.sort((a, b) => b.seconds - a.seconds)
    if (shortageCandidates[0]) diagnoses.push(shortageCandidates[0])
    const travelFraction = travel / elapsedWindow
    if (travelFraction >= 0.5) diagnoses.push({ seconds: travel, text: `Drone spent ${Math.round(travelFraction * 100)}% of its time travelling; inspect the route for detours.` })
    if (overloaded >= 1) diagnoses.push({ seconds: overloaded, text: `Factory exceeded power capacity for ${Math.round(overloaded)} seconds, slowing production.` })
    if (diagnoses.length < 3 && blockedCandidates[0]) diagnoses.push(blockedCandidates[0])
    diagnoses.splice(3)
  }
  return {
    elapsedWindow,
    coreRate,
    throughput,
    powerStability,
    retention,
    efficiency,
    warmingUp: state.stats.delivered < 1 || state.simulatedTime < 15,
    travelFraction: travel / elapsedWindow,
    machineDurations,
    diagnoses,
  }
}

export function makeVictorySnapshot(state: GameState): VictorySnapshot {
  const analysis = analyze(state)
  const completionSeconds = state.simulatedTime
  const score = Math.round(analysis.efficiency * 100)
    + 10 * Math.max(0, 360 - Math.floor(completionSeconds))
    + 2 * state.credits
    - 20 * state.stats.discarded
  return {
    efficiency: analysis.efficiency,
    score,
    completionSeconds,
    creditsRemaining: state.credits,
    travelDistance: state.drone.distance,
    discarded: state.stats.discarded,
    bottlenecks: analysis.diagnoses.map((diagnosis) => diagnosis.text),
  }
}

export function keepOptimizing(state: GameState): void {
  state.victoryAcknowledged = true
  state.paused = false
}

export function markBaseline(state: GameState): BaselineMetric | null {
  const analysis = analyze(state)
  if (analysis.elapsedWindow < 60 - EPSILON) return null
  state.baseline = {
    throughput: analysis.coreRate,
    travelFraction: analysis.travelFraction,
    markedAt: state.simulatedTime,
    programRevision: state.drone.programRevision,
  }
  return state.baseline
}

export function baselineComparison(state: GameState): { ready: boolean; reason?: string; before?: BaselineMetric; current?: BaselineMetric } {
  if (!state.baseline) return { ready: false, reason: 'Mark a baseline after a full 60-second window.' }
  if (state.drone.programRevision <= state.baseline.programRevision) return { ready: false, reason: 'Apply an edited program, then collect a new full window.' }
  if (state.simulatedTime - state.drone.lastAppliedAt < 60 - EPSILON) return { ready: false, reason: 'Collecting a post-edit 60-second window.' }
  const analysis = analyze(state)
  return {
    ready: true,
    before: state.baseline,
    current: { throughput: analysis.coreRate, travelFraction: analysis.travelFraction, markedAt: state.simulatedTime, programRevision: state.drone.programRevision },
  }
}

export function applyDroneSource(state: GameState, source: string): { ok: true } | { ok: false; error: string } {
  try {
    installProgram(state.drone, source, state.simulatedTime)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function buildFactoryFixture(state: GameState): void {
  for (const placement of FACTORY_FIXTURE) {
    const result = placeEntity(state, placement.kind, placement.x, placement.y, placement.orientation)
    if (!result.ok) throw new Error(`Fixture placement failed at ${placement.x},${placement.y}: ${result.reason}`)
  }
}

export function totalItemsInState(state: GameState): number {
  return state.entities.reduce((sum, entity) => sum + countContained(entity), 0) + state.drone.cargo + state.stats.delivered
}
