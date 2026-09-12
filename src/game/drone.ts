import { MAP_HEIGHT, MAP_WIDTH, TERRAIN } from './config'
import type { DroneActivity, DroneOp, DroneState, Entity, Point } from './types'

type AstNode =
  | Extract<DroneOp, { type: 'MOVE_TO' | 'HARVEST' | 'DROP' | 'WAIT' }>
  | { type: 'REPEAT'; count: number; body: AstNode[]; line: number; text: string }
  | { type: 'LOOP'; body: AstNode[]; line: number; text: string }

export class DroneSyntaxError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(line ? `Line ${line}: ${message}` : message)
  }
}

export interface DroneContext {
  entityAt(x: number, y: number): Entity | undefined
  harvest(entity: Entity): 'harvested' | 'unripe' | 'missing'
  drop(entity: Entity, requested: number): { status: 'accepted'; amount: number } | { status: 'full' } | { status: 'invalid'; reason: string }
}

interface SourceLine {
  line: number
  text: string
  tokens: string[]
}

function parseInteger(value: string | undefined, label: string, line: number): number {
  if (value === undefined || !/^-?\d+$/.test(value)) throw new DroneSyntaxError(`${label} must be an integer.`, line)
  return Number(value)
}

function parseNumber(value: string | undefined, label: string, line: number): number {
  if (value === undefined || value.trim() === '' || !Number.isFinite(Number(value))) throw new DroneSyntaxError(`${label} must be a number.`, line)
  return Number(value)
}

function meaningfulLines(source: string): SourceLine[] {
  const physical = source.replace(/\r/g, '').split('\n')
  if (physical.length > 200) throw new DroneSyntaxError('Programs are limited to 200 lines.')
  return physical.flatMap((raw, index) => {
    const text = raw.split('#', 1)[0].trim()
    return text ? [{ line: index + 1, text, tokens: text.split(/\s+/) }] : []
  })
}

function parseBlock(lines: SourceLine[], cursor: { value: number }, depth: number, expectsEnd: boolean): AstNode[] {
  if (depth > 4) throw new DroneSyntaxError('Maximum nesting depth is 4.', lines[Math.max(0, cursor.value - 1)]?.line)
  const nodes: AstNode[] = []
  while (cursor.value < lines.length) {
    const row = lines[cursor.value]
    cursor.value += 1
    const command = row.tokens[0].toUpperCase()
    if (command === 'END') {
      if (row.tokens.length !== 1) throw new DroneSyntaxError('END takes no arguments.', row.line)
      if (!expectsEnd) throw new DroneSyntaxError('Unexpected END.', row.line)
      return nodes
    }
    if (command === 'MOVE_TO') {
      if (row.tokens.length !== 3) throw new DroneSyntaxError('MOVE_TO expects x and y.', row.line)
      const x = parseInteger(row.tokens[1], 'x', row.line)
      const y = parseInteger(row.tokens[2], 'y', row.line)
      if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) throw new DroneSyntaxError(`Coordinate ${x},${y} is outside the map.`, row.line)
      nodes.push({ type: 'MOVE_TO', x, y, line: row.line, text: row.text })
    } else if (command === 'HARVEST') {
      if (row.tokens.length !== 1) throw new DroneSyntaxError('HARVEST takes no arguments.', row.line)
      nodes.push({ type: 'HARVEST', line: row.line, text: row.text })
    } else if (command === 'DROP') {
      if (row.tokens.length < 3 || row.tokens.length > 4) throw new DroneSyntaxError('DROP expects x y [amount].', row.line)
      const x = parseInteger(row.tokens[1], 'x', row.line)
      const y = parseInteger(row.tokens[2], 'y', row.line)
      if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) throw new DroneSyntaxError(`Coordinate ${x},${y} is outside the map.`, row.line)
      const amount = row.tokens[3] === undefined ? undefined : parseInteger(row.tokens[3], 'amount', row.line)
      if (amount !== undefined && (amount < 1 || amount > 4)) throw new DroneSyntaxError('DROP amount must be from 1 to 4.', row.line)
      nodes.push({ type: 'DROP', x, y, amount, line: row.line, text: row.text })
    } else if (command === 'WAIT') {
      if (row.tokens.length !== 2) throw new DroneSyntaxError('WAIT expects seconds.', row.line)
      const seconds = parseNumber(row.tokens[1], 'seconds', row.line)
      if (seconds < 0.1 || seconds > 60) throw new DroneSyntaxError('WAIT must be from 0.1 to 60 seconds.', row.line)
      nodes.push({ type: 'WAIT', seconds, line: row.line, text: row.text })
    } else if (command === 'REPEAT') {
      if (row.tokens.length !== 2) throw new DroneSyntaxError('REPEAT expects a count.', row.line)
      const count = parseInteger(row.tokens[1], 'count', row.line)
      if (count < 1 || count > 100) throw new DroneSyntaxError('REPEAT count must be from 1 to 100.', row.line)
      nodes.push({ type: 'REPEAT', count, body: parseBlock(lines, cursor, depth + 1, true), line: row.line, text: row.text })
    } else if (command === 'LOOP') {
      if (row.tokens.length !== 1) throw new DroneSyntaxError('LOOP takes no arguments.', row.line)
      nodes.push({ type: 'LOOP', body: parseBlock(lines, cursor, depth + 1, true), line: row.line, text: row.text })
    } else {
      throw new DroneSyntaxError(`Unknown command “${row.tokens[0]}”.`, row.line)
    }
  }
  if (expectsEnd) throw new DroneSyntaxError('Missing END for block.', lines.at(-1)?.line)
  return nodes
}

function compileNodes(nodes: AstNode[], output: DroneOp[]): void {
  for (const node of nodes) {
    if (node.type === 'REPEAT') {
      const start = output.length
      output.push({ type: 'REPEAT_START', count: node.count, end: -1, line: node.line, text: node.text })
      compileNodes(node.body, output)
      const end = output.length
      output.push({ type: 'REPEAT_END', start, line: node.line, text: 'END' })
      const entry = output[start]
      if (entry.type === 'REPEAT_START') entry.end = end
    } else if (node.type === 'LOOP') {
      const start = output.length
      compileNodes(node.body, output)
      output.push({ type: 'JUMP', target: start, line: node.line, text: 'END (LOOP)' })
    } else {
      output.push(node)
    }
  }
}

export function compileProgram(source: string): DroneOp[] {
  const lines = meaningfulLines(source)
  if (lines.length === 0) throw new DroneSyntaxError('Program is empty.')
  const cursor = { value: 0 }
  const ast = parseBlock(lines, cursor, 0, false)
  const output: DroneOp[] = []
  compileNodes(ast, output)
  if (output.length === 0) throw new DroneSyntaxError('Program has no executable instructions.')
  return output
}

export function createDrone(source: string): DroneState {
  return {
    x: 4,
    y: 5,
    cargo: 0,
    capacity: 4,
    source,
    program: compileProgram(source),
    pc: 0,
    repeatRemaining: {},
    path: [],
    moveProgress: 0,
    actionRemaining: 0,
    actionActivity: 'idle',
    paused: true,
    error: null,
    message: 'Program ready.',
    currentLine: null,
    currentText: '',
    distance: 0,
    programRevision: 0,
    lastAppliedAt: 0,
  }
}

export function installProgram(drone: DroneState, source: string, simulatedTime: number): void {
  const program = compileProgram(source)
  drone.source = source
  drone.program = program
  drone.pc = 0
  drone.repeatRemaining = {}
  drone.path = []
  drone.moveProgress = 0
  drone.actionRemaining = 0
  drone.actionActivity = 'idle'
  drone.error = null
  drone.message = 'Program applied and running.'
  drone.currentLine = null
  drone.currentText = ''
  drone.paused = false
  drone.programRevision += 1
  drone.lastAppliedAt = simulatedTime
}

export function resetDrone(drone: DroneState): void {
  drone.pc = 0
  drone.repeatRemaining = {}
  drone.path = []
  drone.moveProgress = 0
  drone.actionRemaining = 0
  drone.actionActivity = 'idle'
  drone.error = null
  drone.message = 'Execution reset; position and cargo preserved.'
  drone.currentLine = null
  drone.currentText = ''
  drone.paused = true
}

function pathKey(point: Point): string {
  return `${point.x},${point.y}`
}

export function findDronePath(start: Point, target: Point): Point[] | null {
  if (start.x === target.x && start.y === target.y) return []
  const rocks = new Set(TERRAIN.rocks.map(pathKey))
  if (rocks.has(pathKey(target))) return null
  const directions: Point[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ]
  const queue: Point[] = [start]
  const previous = new Map<string, Point | null>([[pathKey(start), null]])
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y }
      const key = pathKey(next)
      if (next.x < 0 || next.y < 0 || next.x >= MAP_WIDTH || next.y >= MAP_HEIGHT || rocks.has(key) || previous.has(key)) continue
      previous.set(key, current)
      if (next.x === target.x && next.y === target.y) {
        const path: Point[] = [next]
        let cursor = current
        while (cursor.x !== start.x || cursor.y !== start.y) {
          path.push(cursor)
          cursor = previous.get(pathKey(cursor))!
        }
        return path.reverse()
      }
      queue.push(next)
    }
  }
  return null
}

function fail(drone: DroneState, op: DroneOp, reason: string): DroneActivity {
  drone.error = `Line ${op.line}: ${reason}`
  drone.message = drone.error
  drone.paused = true
  drone.path = []
  return 'idle'
}

function setCurrent(drone: DroneState, op: DroneOp): void {
  drone.currentLine = op.line
  drone.currentText = op.text
}

export function stepDrone(drone: DroneState, dt: number, context: DroneContext): DroneActivity {
  if (drone.paused || drone.error) return 'idle'
  if (drone.actionRemaining > 0) {
    const activity = drone.actionActivity
    drone.actionRemaining = Math.max(0, drone.actionRemaining - dt)
    return activity
  }

  let zeroTimeInstructions = 0
  while (zeroTimeInstructions < 64) {
    if (drone.pc < 0 || drone.pc >= drone.program.length) {
      drone.paused = true
      drone.message = 'Program finished.'
      drone.currentLine = null
      drone.currentText = ''
      return 'idle'
    }
    const op = drone.program[drone.pc]
    setCurrent(drone, op)

    if (op.type === 'REPEAT_START') {
      const key = String(drone.pc)
      const remaining = drone.repeatRemaining[key]
      if (remaining === undefined) drone.repeatRemaining[key] = op.count
      if (drone.repeatRemaining[key] <= 0) {
        delete drone.repeatRemaining[key]
        drone.pc = op.end + 1
      } else {
        drone.pc += 1
      }
      zeroTimeInstructions += 1
      continue
    }
    if (op.type === 'REPEAT_END') {
      const key = String(op.start)
      const remaining = (drone.repeatRemaining[key] ?? 1) - 1
      if (remaining > 0) {
        drone.repeatRemaining[key] = remaining
        drone.pc = op.start + 1
      } else {
        delete drone.repeatRemaining[key]
        drone.pc += 1
      }
      zeroTimeInstructions += 1
      continue
    }
    if (op.type === 'JUMP') {
      drone.pc = op.target
      zeroTimeInstructions += 1
      continue
    }
    if (op.type === 'MOVE_TO') {
      if (drone.x === op.x && drone.y === op.y) {
        drone.path = []
        drone.moveProgress = 0
        drone.pc += 1
        zeroTimeInstructions += 1
        continue
      }
      if (drone.path.length === 0) {
        const path = findDronePath({ x: drone.x, y: drone.y }, { x: op.x, y: op.y })
        if (!path) return fail(drone, op, `No path to ${op.x},${op.y}.`)
        drone.path = path
      }
      const next = drone.path[0]
      if (!findDronePath({ x: drone.x, y: drone.y }, next)) {
        drone.path = []
        continue
      }
      drone.moveProgress += dt
      if (drone.moveProgress >= 1) {
        drone.moveProgress -= 1
        drone.x = next.x
        drone.y = next.y
        drone.path.shift()
        drone.distance += 1
      }
      drone.message = `Travelling to ${op.x},${op.y}.`
      return 'travel'
    }
    if (op.type === 'HARVEST') {
      if (drone.cargo >= drone.capacity) {
        drone.message = 'Cargo full; HARVEST skipped.'
        drone.pc += 1
        zeroTimeInstructions += 1
        continue
      }
      const entity = context.entityAt(drone.x, drone.y)
      if (!entity || entity.kind !== 'crop') return fail(drone, op, 'HARVEST requires a Crop Plot under the drone.')
      const result = context.harvest(entity)
      if (result === 'harvested') {
        drone.cargo += 1
        drone.pc += 1
        drone.actionActivity = 'harvest'
        drone.actionRemaining = Math.max(0, 0.5 - dt)
        drone.message = `Harvested Xenograin (${drone.cargo}/${drone.capacity}).`
        return 'harvest'
      }
      drone.actionActivity = 'wait'
      drone.actionRemaining = Math.max(0, 0.5 - dt)
      drone.message = 'Crop unripe; retrying in 0.5 seconds.'
      return 'wait'
    }
    if (op.type === 'DROP') {
      if (drone.cargo === 0) {
        drone.message = 'Cargo empty; DROP skipped.'
        drone.pc += 1
        zeroTimeInstructions += 1
        continue
      }
      if (Math.abs(drone.x - op.x) + Math.abs(drone.y - op.y) !== 1) return fail(drone, op, `DROP target ${op.x},${op.y} is not adjacent.`)
      const target = context.entityAt(op.x, op.y)
      if (!target) return fail(drone, op, `DROP target ${op.x},${op.y} is missing.`)
      const requested = Math.min(op.amount ?? drone.cargo, drone.cargo)
      const result = context.drop(target, requested)
      if (result.status === 'invalid') return fail(drone, op, result.reason)
      if (result.status === 'full') {
        drone.actionActivity = 'wait'
        drone.actionRemaining = Math.max(0, 0.5 - dt)
        drone.message = `${target.kind} is full; retrying in 0.5 seconds.`
        return 'wait'
      }
      drone.cargo -= result.amount
      drone.pc += 1
      drone.actionActivity = 'drop'
      drone.actionRemaining = Math.max(0, 0.5 - dt)
      drone.message = `Dropped ${result.amount} Xenograin (${drone.cargo}/${drone.capacity}).`
      return 'drop'
    }
    if (op.type === 'WAIT') {
      drone.pc += 1
      drone.actionActivity = 'wait'
      drone.actionRemaining = Math.max(0, op.seconds - dt)
      drone.message = `Waiting ${op.seconds.toFixed(1)} seconds.`
      return 'wait'
    }
  }
  const op = drone.program[Math.min(drone.pc, drone.program.length - 1)]
  return fail(drone, op, 'Exceeded 64 zero-time control instructions in one tick.')
}
