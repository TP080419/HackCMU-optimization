export const ITEM_IDS = [
  'xenograin',
  'water',
  'crystite',
  'gel',
  'biofiber',
  'core',
] as const

export type ItemId = (typeof ITEM_IDS)[number]

export type Direction = 'north' | 'east' | 'south' | 'west'

export type CropStage = 'empty' | 'planted' | 'growing' | 'ripe'

export type EntityKind =
  | 'crop'
  | 'belt'
  | 'inserter'
  | 'hopper'
  | 'waterExtractor'
  | 'crystiteDrill'
  | 'gelRefinery'
  | 'fiberMill'
  | 'coreAssembler'
  | 'uplink'
  | 'pylon'
  | 'ruin'

export type EntityStatus = 'idle' | 'working' | 'starved' | 'blocked' | 'offline'

export interface GridPoint {
  x: number
  y: number
}

export interface BeltItem {
  id: number
  item: ItemId
  lane: 0 | 1
  progress: number
}

export interface EntityV2 extends GridPoint {
  id: string
  name: string
  kind: EntityKind
  width: number
  height: number
  direction: Direction
  status: EntityStatus
  inputs: Partial<Record<ItemId, number>>
  outputs: Partial<Record<ItemId, number>>
  inputCapacity: Partial<Record<ItemId, number>>
  outputCapacity: Partial<Record<ItemId, number>>
  progress: number
  powered: boolean
  recipe?: 'gel' | 'biofiber' | 'core'
  cropStage?: CropStage
  cropGrowth?: number
  cropGrowthRate?: number
  beltItems?: BeltItem[]
  sourceId?: string
  targetId?: string
  carriedItem?: ItemId
  cycle?: number
  decorativeVariant?: number
}

export interface DroneCargoStack {
  item: ItemId
  amount: number
}

export interface DroneAction {
  kind: 'move' | 'harvest' | 'plant' | 'load' | 'unload' | 'wait'
  target?: string
  item?: ItemId
  amount?: number
  remainingMs: number
  totalMs: number
  from?: GridPoint
  to?: GridPoint
}

export interface DroneStateV2 extends GridPoint {
  id: 'drone-01'
  capacity: number
  cargo: DroneCargoStack[]
  action: DroneAction | null
  status: 'idle' | 'moving' | 'harvesting' | 'planting' | 'loading' | 'unloading' | 'error'
  facing: Direction
  emptyDistance: number
  loadedDistance: number
  pathHistory: Array<GridPoint & { loaded: boolean; ageMs: number }>
}

export interface ProgramDiagnostic {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
}

export type ProgramValue = number | boolean | string | null | ProgramValue[]

export type Expression =
  | { kind: 'literal'; value: ProgramValue; line: number }
  | { kind: 'name'; name: string; line: number }
  | { kind: 'unary'; operator: '-' | '+' | 'not'; operand: Expression; line: number }
  | {
      kind: 'binary'
      operator: '+' | '-' | '*' | '/' | '//' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or'
      left: Expression
      right: Expression
      line: number
    }
  | { kind: 'call'; callee: string; args: Expression[]; line: number }

export type ProgramStatement =
  | { kind: 'assign'; name: string; value: Expression; line: number }
  | { kind: 'expression'; expression: Expression; line: number }
  | { kind: 'if'; branches: Array<{ condition: Expression; body: ProgramStatement[] }>; elseBody: ProgramStatement[]; line: number }
  | { kind: 'while'; condition: Expression; body: ProgramStatement[]; line: number }
  | { kind: 'for'; name: string; iterable: Expression; body: ProgramStatement[]; line: number }
  | { kind: 'function'; name: string; params: string[]; body: ProgramStatement[]; line: number }
  | { kind: 'return'; value: Expression | null; line: number }

export interface ProgramAst {
  source: string
  body: ProgramStatement[]
  diagnostics: ProgramDiagnostic[]
}

export type CompiledInstruction =
  | { op: 'assign'; name: string; value: Expression; line: number }
  | { op: 'expression'; expression: Expression; line: number }
  | { op: 'jumpIfFalse'; condition: Expression; target: number; line: number }
  | { op: 'jump'; target: number; line: number }
  | { op: 'forInit'; loopId: string; name: string; iterable: Expression; exit: number; line: number }
  | { op: 'forNext'; loopId: string; name: string; body: number; exit: number; line: number }
  | { op: 'callUser'; name: string; args: Expression[]; assignTo?: string; line: number }
  | { op: 'return'; value: Expression | null; line: number }
  | { op: 'halt'; line: number }

export interface CompiledFunction {
  name: string
  params: string[]
  instructions: CompiledInstruction[]
  line: number
}

export interface CompiledProgram {
  main: CompiledInstruction[]
  functions: Record<string, CompiledFunction>
}

export interface ProgramFrame {
  functionName: string
  pc: number
  locals: Record<string, ProgramValue>
  returnTarget?: string
}

export interface ProgramLoopState {
  values: ProgramValue[]
  index: number
}

export interface ProgramRuntime {
  mode: 'stopped' | 'running' | 'paused' | 'error' | 'complete'
  source: string
  ast: ProgramAst | null
  compiled: CompiledProgram | null
  frames: ProgramFrame[]
  globals: Record<string, ProgramValue>
  loops: Record<string, ProgramLoopState>
  currentLine: number | null
  lastSensor: string
  usedSensors: string[]
  lastError: string | null
  pendingAction: boolean
  pauseAfterAction: boolean
  instructionCount: number
  loopIterations: number
  lineCosts: Record<string, number>
}

export interface MissionState {
  phase: 1 | 2 | 3 | 4 | 5 | 6
  completedObjectives: string[]
  stabilityMs: number
  sandboxUnlocked: boolean
  tutorialDismissed: boolean
}

export interface MetricsState {
  coresDelivered: number
  coreProductionTimes: number[]
  refineryStarvedMs: number
  millStarvedMs: number
  beltBlockedMs: number
  energyUsed: number
  powerStableMs: number
  totalElapsedMs: number
  xenograinDistance: number
}

export interface SimulationStateV2 {
  version: 2
  seed: number
  tick: number
  timeMs: number
  paused: boolean
  speed: 1 | 2 | 4
  credits: number
  power: { capacity: number; demand: number; stability: number }
  flowVision: boolean
  selectedEntityId: string | null
  nextItemId: number
  entities: EntityV2[]
  drone: DroneStateV2
  mission: MissionState
  metrics: MetricsState
  runtime: ProgramRuntime
  events: SimulationEvent[]
  settings: {
    muted: boolean
    volume: number
    reducedMotion: boolean
  }
}

export type GameCommand =
  | { type: 'advance'; elapsedMs: number }
  | { type: 'togglePause' }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'setSpeed'; speed: 1 | 2 | 4 }
  | { type: 'loadProgram'; source: string }
  | { type: 'runProgram' }
  | { type: 'pauseProgram' }
  | { type: 'stepProgram' }
  | { type: 'resetProgram' }
  | { type: 'selectEntity'; entityId: string | null }
  | { type: 'toggleFlowVision' }
  | { type: 'moveEntity'; entityId: string; x: number; y: number }
  | { type: 'rotateEntity'; entityId: string }
  | { type: 'build'; kind: EntityKind; x: number; y: number }
  | { type: 'demolish'; entityId: string }
  | { type: 'setSetting'; key: 'muted' | 'volume' | 'reducedMotion'; value: boolean | number }
  | { type: 'loadState'; state: SimulationStateV2 }

export type SimulationEvent =
  | { id: string; type: 'cropStage'; tick: number; entityId: string; stage: CropStage }
  | { id: string; type: 'droneAction'; tick: number; action: DroneAction['kind']; entityId?: string }
  | { id: string; type: 'machineCycle'; tick: number; entityId: string; item: ItemId }
  | { id: string; type: 'coreDelivered'; tick: number; total: number }
  | { id: string; type: 'phaseAdvanced'; tick: number; phase: MissionState['phase'] }
  | { id: string; type: 'programError'; tick: number; message: string; line: number | null }
  | { id: string; type: 'worldEdited'; tick: number }

export interface RenderEntity extends GridPoint {
  id: string
  name: string
  kind: EntityKind
  width: number
  height: number
  direction: Direction
  status: EntityStatus
  progress: number
  cropStage?: CropStage
  cropGrowth?: number
  beltItems?: BeltItem[]
  carriedItem?: ItemId
  inputFill: number
  outputFill: number
  selected: boolean
  powered: boolean
  decorativeVariant?: number
}

export interface RenderSnapshot {
  tick: number
  timeMs: number
  entities: RenderEntity[]
  drone: DroneStateV2
  flowVision: boolean
  events: SimulationEvent[]
  metrics: MetricsState
  power: SimulationStateV2['power']
  mission: MissionState
  settings: SimulationStateV2['settings']
}

export interface BenchmarkResult {
  id: string
  simulatedMs: number
  coresPerMinute: number
  coresProduced: number
  emptyTravelPercent: number
  xenograinDistancePerUnit: number
  refineryStarvedPercent: number
  millStarvedPercent: number
  beltBlockedPercent: number
  energyUsed: number
  source: string
}
