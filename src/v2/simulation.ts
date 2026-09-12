import {
  BUILD_COSTS,
  DRONE_CAPACITY,
  LOOP_PROGRAM,
  MACHINE_RECIPES,
  MAP_HEIGHT,
  MAP_WIDTH,
  SIM_STEP_MS,
  STARTER_PROGRAM,
  UNLOCKED_BUILDINGS_BY_PHASE,
} from './config'
import {
  createProgramRuntime,
  executeProgram,
  isItemId,
  resetProgramRuntime,
  resumeProgramAfterAction,
  type ProgramActionRequest,
  type ProgramWorldContext,
} from './program'
import type {
  Direction,
  DroneAction,
  EntityKind,
  EntityV2,
  GameCommand,
  GridPoint,
  ItemId,
  ProgramValue,
  RenderSnapshot,
  SimulationEvent,
  SimulationStateV2,
} from './types'

const DIRECTIONS: Direction[] = ['north', 'east', 'south', 'west']

type EventPayload<T> = T extends SimulationEvent ? Omit<T, 'id' | 'tick'> : never
type SimulationEventPayload = EventPayload<SimulationEvent>

function entity(
  id: string,
  name: string,
  kind: EntityKind,
  x: number,
  y: number,
  width = 1,
  height = 1,
  extras: Partial<EntityV2> = {},
): EntityV2 {
  return {
    id,
    name,
    kind,
    x,
    y,
    width,
    height,
    direction: 'east',
    status: kind === 'ruin' ? 'offline' : 'idle',
    inputs: {},
    outputs: {},
    inputCapacity: {},
    outputCapacity: {},
    progress: 0,
    powered: kind !== 'ruin',
    ...extras,
  }
}

function beltLine(prefix: string, y: number, startX: number, endX: number, targetId: string) {
  const belts: EntityV2[] = []
  for (let x = startX; x <= endX; x += 1) {
    const id = `${prefix}-${x}`
    belts.push(entity(id, id, 'belt', x, y, 1, 1, {
      beltItems: [],
      targetId: x === endX ? targetId : `${prefix}-${x + 1}`,
      outputCapacity: { xenograin: 8, water: 8, crystite: 8, gel: 8, biofiber: 8, core: 8 },
    }))
  }
  return belts
}

function createEntities() {
  const entities: EntityV2[] = []
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const index = row * 6 + column
      const growth = index === 0 ? 1 : ((index * 37) % 100) / 100
      const startsEmpty = index >= 32 && index % 2 === 0
      entities.push(entity(`plot-${row}-${column}`, `plot-${row}-${column}`, 'crop', 2 + column, 4 + row, 1, 1, {
        cropStage: startsEmpty ? 'empty' : growth > 0.76 ? 'ripe' : growth > 0.25 ? 'growing' : 'planted',
        cropGrowth: startsEmpty ? 0 : growth,
        cropGrowthRate: 0.78 + ((index * 17) % 31) / 100,
        decorativeVariant: index % 4,
      }))
    }
  }

  entities.push(
    entity('home', 'home', 'pylon', 8, 7, 1, 2, { outputs: { xenograin: 2 }, outputCapacity: { xenograin: 8 } }),
    entity('gel_input', 'gel_input', 'hopper', 10, 5, 1, 2, { outputs: {}, outputCapacity: { xenograin: 12 } }),
    entity('gel_refinery', 'gel_refinery', 'gelRefinery', 12, 4, 3, 3, {
      recipe: 'gel',
      inputCapacity: { xenograin: 6, water: 4 },
      outputCapacity: { gel: 4 },
    }),
    entity('water_source', 'water_source', 'waterExtractor', 11, 1, 2, 2, { outputCapacity: { water: 8 } }),
    entity('water-feed', 'water feed arm', 'inserter', 13, 2, 1, 1, { sourceId: 'water_source', targetId: 'gel_refinery' }),
    entity('gel-output', 'gel output arm', 'inserter', 15, 6, 1, 1, { sourceId: 'gel_refinery', targetId: 'gel-belt-16' }),

    entity('fiber_input', 'fiber_input', 'hopper', 10, 11, 1, 2, { outputs: {}, outputCapacity: { xenograin: 12 } }),
    entity('fiber_mill', 'fiber_mill', 'fiberMill', 12, 10, 3, 3, {
      recipe: 'biofiber',
      inputCapacity: { xenograin: 5, crystite: 4 },
      outputCapacity: { biofiber: 4 },
    }),
    entity('crystal_source', 'crystal_source', 'crystiteDrill', 10, 15, 2, 2, { outputCapacity: { crystite: 8 } }),
    entity('crystal-feed', 'crystal feed arm', 'inserter', 12, 14, 1, 1, { sourceId: 'crystal_source', targetId: 'fiber_mill' }),
    entity('fiber-output', 'fiber output arm', 'inserter', 15, 11, 1, 1, { sourceId: 'fiber_mill', targetId: 'fiber-belt-16' }),

    ...beltLine('gel-belt', 6, 16, 19, 'gel-assembler-feed'),
    entity('gel-assembler-feed', 'gel assembler arm', 'inserter', 20, 6, 1, 1, { targetId: 'core_assembler' }),
    ...beltLine('fiber-belt', 11, 16, 19, 'fiber-assembler-feed'),
    entity('fiber-assembler-feed', 'fiber assembler arm', 'inserter', 20, 11, 1, 1, { targetId: 'core_assembler' }),
    entity('core_assembler', 'core_assembler', 'coreAssembler', 21, 7, 3, 3, {
      recipe: 'core',
      inputCapacity: { gel: 4, biofiber: 4 },
      outputCapacity: { core: 3 },
    }),
    entity('core-output', 'core output arm', 'inserter', 24, 8, 1, 1, { sourceId: 'core_assembler', targetId: 'core-belt-25' }),
    ...beltLine('core-belt', 8, 25, 27, 'uplink-feed'),
    entity('uplink-feed', 'uplink arm', 'inserter', 28, 8, 1, 1, { targetId: 'uplink' }),
    entity('uplink', 'colony_uplink', 'uplink', 29, 7, 1, 3, { inputCapacity: { core: 6 } }),

    entity('ruin-arch', 'collapsed gate', 'ruin', 8, 14, 2, 2, { decorativeVariant: 0 }),
    entity('ruin-pipe', 'fractured pipeline', 'ruin', 17, 2, 3, 1, { decorativeVariant: 1 }),
    entity('ruin-dish', 'silent relay', 'ruin', 25, 14, 2, 2, { decorativeVariant: 2 }),
  )
  return entities
}

export function createInitialState(source = STARTER_PROGRAM): SimulationStateV2 {
  return {
    version: 2,
    seed: 0x58454e4f,
    tick: 0,
    timeMs: 0,
    paused: true,
    speed: 1,
    credits: 180,
    power: { capacity: 120, demand: 82, stability: 100 },
    flowVision: false,
    selectedEntityId: null,
    nextItemId: 1,
    entities: createEntities(),
    drone: {
      id: 'drone-01',
      x: 8,
      y: 7,
      capacity: DRONE_CAPACITY,
      cargo: [],
      action: null,
      status: 'idle',
      facing: 'west',
      emptyDistance: 0,
      loadedDistance: 0,
      pathHistory: [],
    },
    mission: { phase: 1, completedObjectives: [], stabilityMs: 0, sandboxUnlocked: false, tutorialDismissed: false },
    metrics: {
      coresDelivered: 0,
      coreProductionTimes: [],
      refineryStarvedMs: 0,
      millStarvedMs: 0,
      beltBlockedMs: 0,
      energyUsed: 0,
      powerStableMs: 0,
      totalElapsedMs: 0,
      xenograinDistance: 0,
    },
    runtime: createProgramRuntime(source),
    events: [],
    settings: { muted: false, volume: 0.55, reducedMotion: false },
  }
}

function findEntity(state: SimulationStateV2, idOrName: string) {
  return state.entities.find((candidate) => candidate.id === idOrName || candidate.name === idOrName)
}

function emit(state: SimulationStateV2, event: SimulationEventPayload) {
  state.events.push({ ...event, id: `${state.tick}-${state.events.length}-${event.type}`, tick: state.tick } as SimulationEvent)
  if (state.events.length > 80) state.events.splice(0, state.events.length - 80)
}

function amount(record: Partial<Record<ItemId, number>>, item: ItemId) {
  return record[item] ?? 0
}

function change(record: Partial<Record<ItemId, number>>, item: ItemId, delta: number) {
  const next = Math.max(0, amount(record, item) + delta)
  if (next === 0) delete record[item]
  else record[item] = next
}

function cargoAmount(state: SimulationStateV2, item?: ItemId) {
  return state.drone.cargo.reduce((total, stack) => total + (item && stack.item !== item ? 0 : stack.amount), 0)
}

function changeCargo(state: SimulationStateV2, item: ItemId, delta: number) {
  const stack = state.drone.cargo.find((candidate) => candidate.item === item)
  if (stack) {
    stack.amount = Math.max(0, stack.amount + delta)
    if (stack.amount === 0) state.drone.cargo = state.drone.cargo.filter((candidate) => candidate !== stack)
  } else if (delta > 0) state.drone.cargo.push({ item, amount: delta })
}

function manhattan(from: GridPoint, to: GridPoint) {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
}

function directionBetween(from: GridPoint, to: GridPoint): Direction {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west'
  return dy >= 0 ? 'south' : 'north'
}

function pointForTarget(state: SimulationStateV2, value: string): GridPoint | null {
  if (value === 'home') return { x: 8, y: 7 }
  const target = findEntity(state, value)
  return target ? { x: target.x, y: target.y } : null
}

function validateString(value: ProgramValue, line: number, label: string) {
  if (typeof value !== 'string') throw new Error(`第 ${line} 行：${label} 必须是名称字符串。`)
  return value
}

function validateNumber(value: ProgramValue, line: number, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`第 ${line} 行：${label} 必须是数字。`)
  return value
}

function programContext(state: SimulationStateV2): ProgramWorldContext {
  return {
    readSensor(name, args, line) {
      if (name === 'farm_zone') return state.entities.filter((candidate) => candidate.kind === 'crop').map((candidate) => candidate.id)
      if (name === 'is_ripe') {
        const target = findEntity(state, validateString(args[0], line, '地块'))
        return target?.kind === 'crop' && target.cropStage === 'ripe'
      }
      if (name === 'cargo_free') return state.drone.capacity - cargoAmount(state)
      if (name === 'cargo') {
        if (!args.length) return cargoAmount(state)
        if (!isItemId(args[0])) throw new Error(`第 ${line} 行：cargo 的参数必须是物品常量。`)
        return cargoAmount(state, args[0])
      }
      if (name === 'need') {
        const targetName = validateString(args[0], line, '机器')
        if (!isItemId(args[1])) throw new Error(`第 ${line} 行：need 的第二个参数必须是物品常量。`)
        const target = findEntity(state, targetName)
        if (!target) throw new Error(`第 ${line} 行：找不到命名机器 ${targetName}。`)
        const recipeNeed = target.recipe ? (MACHINE_RECIPES[target.recipe].inputs as Partial<Record<ItemId, number>>)[args[1]] ?? 0 : 0
        const desired = recipeNeed > 0 ? recipeNeed * 2 : amount(target.inputCapacity, args[1])
        const recipeOutput = target.recipe ? MACHINE_RECIPES[target.recipe].output : null
        if (recipeOutput && amount(target.outputs, recipeOutput) >= amount(target.outputCapacity, recipeOutput)) return 0
        if (recipeOutput === 'gel' || recipeOutput === 'biofiber') {
          const downstreamStock = state.entities.reduce((total, entry) => {
            const buffered = amount(entry.outputs, recipeOutput) + (entry.id === 'core_assembler' ? amount(entry.inputs, recipeOutput) : 0)
            const moving = (entry.beltItems ?? []).filter((beltItem) => beltItem.item === recipeOutput).length
            const carried = entry.carriedItem === recipeOutput ? 1 : 0
            return total + buffered + moving + carried
          }, 0)
          if (downstreamStock >= 3) return 0
        }
        const queued = targetName === 'gel_refinery'
          ? amount(findEntity(state, 'gel_input')?.outputs ?? {}, args[1])
          : targetName === 'fiber_mill'
            ? amount(findEntity(state, 'fiber_input')?.outputs ?? {}, args[1])
            : 0
        return Math.max(0, desired - amount(target.inputs, args[1]) - queued)
      }
      if (name === 'distance_to') {
        const targetName = validateString(args[0], line, '目标')
        const point = pointForTarget(state, targetName)
        if (!point) throw new Error(`第 ${line} 行：找不到目标 ${targetName}。`)
        return manhattan(state.drone, point)
      }
      throw new Error(`第 ${line} 行：API ${name} 不存在或尚未解锁。`)
    },
    createAction(name, args, line) {
      if (name === 'move_to') {
        const target = validateString(args[0], line, '目标')
        const point = pointForTarget(state, target)
        if (!point) throw new Error(`第 ${line} 行：找不到目标 ${target}。`)
        return { name, args: [target], line }
      }
      if (name === 'harvest' || name === 'plant') return { name, args: [], line }
      if (name === 'load' || name === 'unload') {
        const target = validateString(args[0], line, '端点')
        if (!findEntity(state, target)) throw new Error(`第 ${line} 行：找不到端点 ${target}。`)
        if (!isItemId(args[1])) throw new Error(`第 ${line} 行：${name} 的第二个参数必须是物品常量。`)
        const requested = Math.max(0, Math.floor(validateNumber(args[2] ?? cargoAmount(state, args[1]), line, '数量')))
        return { name, args: [target, args[1], requested], line }
      }
      if (name === 'wait') return { name, args: [Math.max(0.1, validateNumber(args[0] ?? 0.5, line, '秒数'))], line }
      return null
    },
  }
}

function beginDroneAction(state: SimulationStateV2, request: ProgramActionRequest) {
  let action: DroneAction
  if (request.name === 'move_to') {
    const target = String(request.args[0])
    const point = pointForTarget(state, target)!
    const distance = manhattan(state.drone, point)
    action = { kind: 'move', target, remainingMs: Math.max(260, distance * 310), totalMs: Math.max(260, distance * 310), from: { x: state.drone.x, y: state.drone.y }, to: point }
    state.drone.facing = directionBetween(state.drone, point)
    state.drone.status = 'moving'
  } else if (request.name === 'harvest') {
    action = { kind: 'harvest', remainingMs: 850, totalMs: 850 }
    state.drone.status = 'harvesting'
  } else if (request.name === 'plant') {
    action = { kind: 'plant', remainingMs: 620, totalMs: 620 }
    state.drone.status = 'planting'
  } else if (request.name === 'load') {
    action = { kind: 'load', target: String(request.args[0]), item: request.args[1] as ItemId, amount: Number(request.args[2]), remainingMs: 520, totalMs: 520 }
    state.drone.status = 'loading'
  } else if (request.name === 'unload') {
    action = { kind: 'unload', target: String(request.args[0]), item: request.args[1] as ItemId, amount: Number(request.args[2]), remainingMs: 520, totalMs: 520 }
    state.drone.status = 'unloading'
  } else {
    const duration = Math.max(100, Number(request.args[0]) * 1000)
    action = { kind: 'wait', remainingMs: duration, totalMs: duration }
    state.drone.status = 'idle'
  }
  state.drone.action = action
  emit(state, { type: 'droneAction', action: action.kind, entityId: action.target })
}

function completeDroneAction(state: SimulationStateV2, action: DroneAction) {
  if (action.kind === 'move' && action.to && action.from) {
    const distance = manhattan(action.from, action.to)
    const loaded = cargoAmount(state) > 0
    state.drone.x = action.to.x
    state.drone.y = action.to.y
    if (loaded) state.drone.loadedDistance += distance
    else state.drone.emptyDistance += distance
    if (loaded && cargoAmount(state, 'xenograin') > 0) state.metrics.xenograinDistance += distance
    state.drone.pathHistory.push({ ...action.to, loaded, ageMs: 0 })
  } else if (action.kind === 'harvest') {
    const plot = state.entities.find((candidate) => candidate.kind === 'crop' && candidate.x === state.drone.x && candidate.y === state.drone.y)
    if (plot?.cropStage === 'ripe' && state.drone.capacity - cargoAmount(state) >= 1) {
      changeCargo(state, 'xenograin', 1)
      plot.cropGrowth = 0
      plot.cropStage = 'planted'
      emit(state, { type: 'cropStage', entityId: plot.id, stage: 'planted' })
      if (!state.mission.completedObjectives.includes('first-harvest')) state.mission.completedObjectives.push('first-harvest')
    }
  } else if (action.kind === 'plant') {
    const plot = state.entities.find((candidate) => candidate.kind === 'crop' && candidate.x === state.drone.x && candidate.y === state.drone.y)
    if (plot?.cropStage === 'empty' && cargoAmount(state, 'xenograin') > 0) {
      changeCargo(state, 'xenograin', -1)
      plot.cropGrowth = 0
      plot.cropStage = 'planted'
      emit(state, { type: 'cropStage', entityId: plot.id, stage: 'planted' })
    }
  } else if (action.kind === 'load' && action.target && action.item) {
    const target = findEntity(state, action.target)
    if (target && target.x === state.drone.x && target.y === state.drone.y) {
      const free = state.drone.capacity - cargoAmount(state)
      const moved = Math.min(action.amount ?? free, amount(target.outputs, action.item), free)
      if (moved > 0) {
        change(target.outputs, action.item, -moved)
        changeCargo(state, action.item, moved)
      }
    }
  } else if (action.kind === 'unload' && action.target && action.item) {
    const target = findEntity(state, action.target)
    if (target && target.x === state.drone.x && target.y === state.drone.y) {
      const available = cargoAmount(state, action.item)
      const capacity = amount(target.outputCapacity, action.item) || 99
      const moved = Math.min(action.amount ?? available, available, capacity - amount(target.outputs, action.item))
      if (moved > 0) {
        changeCargo(state, action.item, -moved)
        change(target.outputs, action.item, moved)
        if (!state.mission.completedObjectives.includes('first-unload')) state.mission.completedObjectives.push('first-unload')
      }
    }
  }
  state.drone.action = null
  state.drone.status = 'idle'
  resumeProgramAfterAction(state.runtime)
}

function updateDrone(state: SimulationStateV2, dt: number) {
  for (const point of state.drone.pathHistory) point.ageMs += dt
  state.drone.pathHistory = state.drone.pathHistory.filter((point) => point.ageMs < 12_000)
  if (state.drone.action) {
    state.drone.action.remainingMs -= dt
    if (state.drone.action.remainingMs <= 0) completeDroneAction(state, state.drone.action)
    return
  }
  const request = executeProgram(state.runtime, programContext(state))
  if (state.runtime.mode === 'error' && state.runtime.lastError) {
    const previous = state.events[state.events.length - 1]
    if (previous?.type !== 'programError' || previous.message !== state.runtime.lastError) emit(state, { type: 'programError', message: state.runtime.lastError, line: state.runtime.currentLine })
  }
  if (request) beginDroneAction(state, request)
}

function updateCrops(state: SimulationStateV2, dt: number) {
  for (const plot of state.entities) {
    if (plot.kind !== 'crop' || plot.cropStage === 'empty' || plot.cropStage === 'ripe') continue
    plot.cropGrowth = Math.min(1, (plot.cropGrowth ?? 0) + (dt / 24_000) * (plot.cropGrowthRate ?? 1))
    const next = plot.cropGrowth >= 1 ? 'ripe' : plot.cropGrowth >= 0.28 ? 'growing' : 'planted'
    if (next !== plot.cropStage) {
      plot.cropStage = next
      emit(state, { type: 'cropStage', entityId: plot.id, stage: next })
    }
  }
}

function firstAvailableOutput(source: EntityV2, target: EntityV2): ItemId | null {
  const priorities: ItemId[] = ['core', 'gel', 'biofiber', 'xenograin', 'water', 'crystite']
  for (const item of priorities) {
    if (amount(source.outputs, item) <= 0) continue
    if (target.kind === 'belt') {
      const beltItems = target.beltItems ?? []
      const entryBlocked = beltItems.filter((candidate) => candidate.progress < 0.26).length >= 2 || ([0, 1] as const).every((lane) => beltItems.filter((candidate) => candidate.lane === lane).length >= 4)
      if (!entryBlocked) return item
    } else if (amount(target.inputs, item) < amount(target.inputCapacity, item)) return item
  }
  return null
}

function acceptItem(state: SimulationStateV2, target: EntityV2, item: ItemId) {
  if (target.kind === 'belt') {
    const beltItems = target.beltItems ?? (target.beltItems = [])
    const lane = ([0, 1] as const).find((candidateLane) => beltItems.filter((candidate) => candidate.lane === candidateLane).length < 4 && !beltItems.some((candidate) => candidate.lane === candidateLane && candidate.progress < 0.3))
    if (lane === undefined) return false
    beltItems.push({ id: state.nextItemId++, item, lane, progress: 0 })
    return true
  }
  if (target.kind === 'inserter') {
    if (target.carriedItem) return false
    target.carriedItem = item
    target.cycle = 0
    return true
  }
  if (amount(target.inputs, item) >= amount(target.inputCapacity, item)) return false
  change(target.inputs, item, 1)
  return true
}

function updateProducers(state: SimulationStateV2, dt: number) {
  for (const producer of state.entities) {
    if (producer.kind !== 'waterExtractor' && producer.kind !== 'crystiteDrill') continue
    const item: ItemId = producer.kind === 'waterExtractor' ? 'water' : 'crystite'
    producer.progress += dt / 2_600
    if (producer.progress >= 1 && amount(producer.outputs, item) < amount(producer.outputCapacity, item)) {
      producer.progress -= 1
      change(producer.outputs, item, 1)
      producer.status = 'working'
    }
  }
}

function updateInserters(state: SimulationStateV2, dt: number) {
  for (const arm of state.entities) {
    if (arm.kind !== 'inserter') continue
    const target = arm.targetId ? findEntity(state, arm.targetId) : undefined
    if (!target) {
      arm.status = 'offline'
      continue
    }
    if (!arm.carriedItem && arm.sourceId) {
      const source = findEntity(state, arm.sourceId)
      if (source) {
        const item = firstAvailableOutput(source, target)
        if (item) {
          change(source.outputs, item, -1)
          arm.carriedItem = item
          arm.cycle = 0
        }
      }
    }
    if (!arm.carriedItem) {
      arm.status = 'idle'
      continue
    }
    arm.status = 'working'
    arm.cycle = Math.min(1, (arm.cycle ?? 0) + dt / 720)
    if (arm.cycle >= 1 && acceptItem(state, target, arm.carriedItem)) {
      arm.carriedItem = undefined
      arm.cycle = 0
    }
  }
}

function updateBelts(state: SimulationStateV2, dt: number) {
  const belts = state.entities.filter((candidate) => candidate.kind === 'belt')
  let anyBlocked = false
  for (let index = belts.length - 1; index >= 0; index -= 1) {
    const belt = belts[index]
    const items = belt.beltItems ?? []
    for (const item of items) item.progress = Math.min(1, item.progress + dt / 1_350)
    items.sort((a, b) => b.progress - a.progress)
    const target = belt.targetId ? findEntity(state, belt.targetId) : undefined
    for (const item of [...items].filter((candidate) => candidate.progress >= 1)) {
      if (target && acceptItem(state, target, item.item)) items.splice(items.indexOf(item), 1)
      else {
        belt.status = 'blocked'
        anyBlocked = true
      }
    }
    if (!items.length) belt.status = 'idle'
    else if (belt.status !== 'blocked') belt.status = 'working'
  }
  if (anyBlocked) state.metrics.beltBlockedMs += dt
}

function hasInputs(machine: EntityV2, inputs: Partial<Record<ItemId, number>>) {
  return Object.entries(inputs).every(([item, required]) => amount(machine.inputs, item as ItemId) >= (required ?? 0))
}

function updateMachines(state: SimulationStateV2, dt: number) {
  for (const machine of state.entities) {
    if (!machine.recipe) continue
    const recipe = MACHINE_RECIPES[machine.recipe]
    if (machine.progress <= 0) {
      if (!hasInputs(machine, recipe.inputs)) {
        machine.status = 'starved'
        if (machine.kind === 'gelRefinery') state.metrics.refineryStarvedMs += dt
        if (machine.kind === 'fiberMill') state.metrics.millStarvedMs += dt
        continue
      }
      for (const [item, required] of Object.entries(recipe.inputs)) change(machine.inputs, item as ItemId, -(required ?? 0))
      machine.progress = 0.001
    }
    const outputCapacity = amount(machine.outputCapacity, recipe.output)
    if (machine.progress >= 1 && amount(machine.outputs, recipe.output) >= outputCapacity) {
      machine.status = 'blocked'
      continue
    }
    machine.status = 'working'
    machine.progress += dt / recipe.durationMs
    if (machine.progress >= 1) {
      change(machine.outputs, recipe.output, 1)
      machine.progress = 0
      emit(state, { type: 'machineCycle', entityId: machine.id, item: recipe.output })
      if (recipe.output === 'gel' && !state.mission.completedObjectives.includes('first-gel')) state.mission.completedObjectives.push('first-gel')
      if (recipe.output === 'biofiber' && !state.mission.completedObjectives.includes('first-fiber')) state.mission.completedObjectives.push('first-fiber')
    }
  }
}

function updateUplink(state: SimulationStateV2) {
  const uplink = findEntity(state, 'uplink')
  if (!uplink) return
  const cores = amount(uplink.inputs, 'core')
  if (cores <= 0) return
  change(uplink.inputs, 'core', -1)
  state.metrics.coresDelivered += 1
  state.metrics.coreProductionTimes.push(state.timeMs)
  state.metrics.coreProductionTimes = state.metrics.coreProductionTimes.filter((time) => time >= state.timeMs - 120_000)
  emit(state, { type: 'coreDelivered', total: state.metrics.coresDelivered })
}

function recentCoresPerMinute(state: SimulationStateV2) {
  const recent = state.metrics.coreProductionTimes.filter((time) => time >= state.timeMs - 60_000)
  if (state.timeMs < 60_000) return recent.length * (60_000 / Math.max(1, state.timeMs))
  return recent.length
}

function phaseAdvance(state: SimulationStateV2, phase: 2 | 3 | 4 | 5 | 6) {
  if (state.mission.phase >= phase) return
  state.mission.phase = phase
  state.mission.stabilityMs = 0
  emit(state, { type: 'phaseAdvanced', phase })
}

function updateMission(state: SimulationStateV2, dt: number) {
  if (state.mission.phase === 1 && state.mission.completedObjectives.includes('first-harvest') && state.mission.completedObjectives.includes('first-unload')) phaseAdvance(state, 2)
  if (state.mission.phase === 2 && state.runtime.instructionCount > 5 && /while\s+True\s*:/.test(state.runtime.source) && /for\s+\w+\s+in\s+farm_zone\(\)/.test(state.runtime.source) && /is_ripe\s*\(/.test(state.runtime.source)) phaseAdvance(state, 3)
  if (state.mission.phase === 3 && state.mission.completedObjectives.includes('first-gel') && state.mission.completedObjectives.includes('first-fiber')) phaseAdvance(state, 4)
  if (state.mission.phase === 4 && state.runtime.instructionCount > 5 && state.runtime.usedSensors?.includes('need') && state.metrics.coresDelivered >= 1) phaseAdvance(state, 5)
  if (state.mission.phase !== 5) return
  const totalDistance = state.drone.emptyDistance + state.drone.loadedDistance
  const emptyPercent = totalDistance > 0 ? state.drone.emptyDistance / totalDistance : 1
  const qualifies = state.metrics.coresDelivered >= 6 && recentCoresPerMinute(state) >= 1 && emptyPercent < 0.35 && state.power.stability >= 90
  state.mission.stabilityMs = qualifies ? state.mission.stabilityMs + dt : 0
  if (state.mission.stabilityMs >= 90_000) {
    state.mission.sandboxUnlocked = true
    phaseAdvance(state, 6)
  }
}

export function advanceSimulation(state: SimulationStateV2, dt = SIM_STEP_MS) {
  state.tick += 1
  state.timeMs += dt
  state.metrics.totalElapsedMs += dt
  state.power.capacity = 60 + state.entities.filter((candidate) => candidate.kind === 'pylon').length * 60
  state.power.demand = state.entities.reduce((total, candidate) => total + (candidate.kind === 'belt' ? 0.25 : candidate.kind === 'inserter' ? 1.1 : candidate.recipe ? 11 : candidate.kind === 'waterExtractor' || candidate.kind === 'crystiteDrill' ? 7 : 0), 0)
  state.power.stability = Math.min(100, (state.power.capacity / Math.max(1, state.power.demand)) * 100)
  if (state.power.stability >= 90) state.metrics.powerStableMs += dt
  state.metrics.energyUsed += (state.power.demand * dt) / 3_600_000
  updateCrops(state, dt)
  updateDrone(state, dt)
  updateProducers(state, dt)
  updateInserters(state, dt)
  updateBelts(state, dt)
  updateMachines(state, dt)
  updateUplink(state)
  updateMission(state, dt)
}

function resetStability(state: SimulationStateV2) {
  state.mission.stabilityMs = 0
  emit(state, { type: 'worldEdited' })
}

function occupied(state: SimulationStateV2, x: number, y: number) {
  return x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT || state.entities.some((candidate) => x >= candidate.x && x < candidate.x + candidate.width && y >= candidate.y && y < candidate.y + candidate.height)
}

function addBuilding(state: SimulationStateV2, kind: EntityKind, x: number, y: number) {
  const unlocked = UNLOCKED_BUILDINGS_BY_PHASE[state.mission.phase] ?? []
  const cost = BUILD_COSTS[kind]
  if (!unlocked.includes(kind) || cost === undefined || state.credits < cost || occupied(state, x, y)) return
  state.credits -= cost
  const id = `${kind}-${state.tick}-${state.entities.length}`
  const extras: Partial<EntityV2> = kind === 'belt'
    ? { beltItems: [] }
    : kind === 'hopper'
      ? { outputCapacity: { xenograin: 12, water: 12, crystite: 12, gel: 12, biofiber: 12, core: 12 } }
      : kind === 'gelRefinery'
        ? { recipe: 'gel', width: 3, height: 3, inputCapacity: { xenograin: 6, water: 4 }, outputCapacity: { gel: 4 } }
        : kind === 'fiberMill'
          ? { recipe: 'biofiber', width: 3, height: 3, inputCapacity: { xenograin: 5, crystite: 4 }, outputCapacity: { biofiber: 4 } }
          : kind === 'coreAssembler'
            ? { recipe: 'core', width: 3, height: 3, inputCapacity: { gel: 4, biofiber: 4 }, outputCapacity: { core: 3 } }
            : kind === 'waterExtractor'
              ? { width: 2, height: 2, outputCapacity: { water: 8 } }
              : kind === 'crystiteDrill'
                ? { width: 2, height: 2, outputCapacity: { crystite: 8 } }
                : {}
  if (kind === 'inserter' && x === 11 && y === 6) Object.assign(extras, { sourceId: 'gel_input', targetId: 'gel_refinery', name: 'gel feed arm' })
  if (kind === 'inserter' && x === 11 && y === 11) Object.assign(extras, { sourceId: 'fiber_input', targetId: 'fiber_mill', name: 'fiber feed arm' })
  const built = entity(id, typeof extras.name === 'string' ? extras.name : id, kind, x, y, extras.width ?? 1, extras.height ?? 1, extras)
  state.entities.push(built)
  resetStability(state)
}

export function applyGameCommand(state: SimulationStateV2, command: GameCommand): SimulationStateV2 {
  if (command.type === 'advance') return state
  if (command.type === 'togglePause') state.paused = !state.paused
  else if (command.type === 'setPaused') state.paused = command.paused
  else if (command.type === 'setSpeed') state.speed = command.speed
  else if (command.type === 'toggleFlowVision') state.flowVision = !state.flowVision
  else if (command.type === 'selectEntity') state.selectedEntityId = command.entityId
  else if (command.type === 'loadProgram') {
    state.runtime = createProgramRuntime(command.source)
    resetStability(state)
  } else if (command.type === 'runProgram') {
    if (state.runtime.mode === 'complete' || state.runtime.mode === 'error') state.runtime = resetProgramRuntime(state.runtime)
    if (state.runtime.compiled) state.runtime.mode = 'running'
    state.paused = false
  } else if (command.type === 'pauseProgram') state.runtime.mode = 'paused'
  else if (command.type === 'stepProgram') {
    if (state.runtime.mode === 'complete' || state.runtime.mode === 'error') state.runtime = resetProgramRuntime(state.runtime)
    state.runtime.mode = 'running'
    state.runtime.pauseAfterAction = true
    state.paused = false
  } else if (command.type === 'resetProgram') {
    state.runtime = createProgramRuntime(state.runtime.source)
    state.drone.action = null
    state.drone.status = 'idle'
  } else if (command.type === 'moveEntity') {
    const target = findEntity(state, command.entityId)
    if (target && !occupied({ ...state, entities: state.entities.filter((candidate) => candidate.id !== target.id) }, command.x, command.y)) {
      target.x = command.x
      target.y = command.y
      resetStability(state)
    }
  } else if (command.type === 'rotateEntity') {
    const target = findEntity(state, command.entityId)
    if (target) {
      target.direction = DIRECTIONS[(DIRECTIONS.indexOf(target.direction) + 1) % DIRECTIONS.length]
      resetStability(state)
    }
  } else if (command.type === 'build') addBuilding(state, command.kind, command.x, command.y)
  else if (command.type === 'demolish') {
    const target = findEntity(state, command.entityId)
    if (target && !target.id.includes('plot') && target.kind !== 'uplink' && target.id !== 'home') {
      state.entities = state.entities.filter((candidate) => candidate !== target)
      state.credits += Math.floor((BUILD_COSTS[target.kind] ?? 0) * 0.8)
      resetStability(state)
    }
  } else if (command.type === 'setSetting') {
    if (command.key === 'volume' && typeof command.value === 'number') state.settings.volume = Math.max(0, Math.min(1, command.value))
    if (command.key === 'muted' && typeof command.value === 'boolean') state.settings.muted = command.value
    if (command.key === 'reducedMotion' && typeof command.value === 'boolean') state.settings.reducedMotion = command.value
  } else if (command.type === 'loadState') return command.state
  return state
}

export function createRenderSnapshot(state: SimulationStateV2): RenderSnapshot {
  return {
    tick: state.tick,
    timeMs: state.timeMs,
    entities: state.entities.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      kind: candidate.kind,
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
      direction: candidate.direction,
      status: candidate.status,
      progress: candidate.progress,
      cropStage: candidate.cropStage,
      cropGrowth: candidate.cropGrowth,
      beltItems: candidate.beltItems?.map((item) => ({ ...item })),
      carriedItem: candidate.carriedItem,
      inputFill: Object.entries(candidate.inputCapacity).reduce((total, [item, capacity]) => total + amount(candidate.inputs, item as ItemId) / Math.max(1, capacity ?? 1), 0),
      outputFill: Object.entries(candidate.outputCapacity).reduce((total, [item, capacity]) => total + amount(candidate.outputs, item as ItemId) / Math.max(1, capacity ?? 1), 0),
      selected: state.selectedEntityId === candidate.id,
      powered: candidate.powered,
      decorativeVariant: candidate.decorativeVariant,
    })),
    drone: JSON.parse(JSON.stringify(state.drone)) as SimulationStateV2['drone'],
    flowVision: state.flowVision,
    events: state.events.slice(-18),
    metrics: { ...state.metrics, coreProductionTimes: [...state.metrics.coreProductionTimes] },
    power: { ...state.power },
    mission: { ...state.mission, completedObjectives: [...state.mission.completedObjectives] },
    settings: { ...state.settings },
  }
}

export function cloneState(state: SimulationStateV2) {
  return JSON.parse(JSON.stringify(state)) as SimulationStateV2
}

export function loadLoopProgram(state: SimulationStateV2) {
  return applyGameCommand(state, { type: 'loadProgram', source: LOOP_PROGRAM })
}
