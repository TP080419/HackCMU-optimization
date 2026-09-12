export type ItemType =
  | 'xenograin'
  | 'water'
  | 'crystite'
  | 'gel'
  | 'biofiber'
  | 'core'

export type BuildableKind =
  | 'belt'
  | 'splitter'
  | 'crate'
  | 'crop'
  | 'waterExtractor'
  | 'crystiteDrill'
  | 'gelRefinery'
  | 'fiberMill'
  | 'coreAssembler'
  | 'solarPylon'

export type EntityKind = BuildableKind | 'uplink'
export type Orientation = 0 | 1 | 2 | 3
export type MachineStatus = 'WORKING' | 'STARVED' | 'BLOCKED' | 'NO POWER' | 'READY'
export type ScenarioMode = 'demo' | 'new'
export type DroneActivity = 'travel' | 'wait' | 'harvest' | 'drop' | 'idle'

export interface Point {
  x: number
  y: number
}

export interface Recipe {
  inputs: Partial<Record<ItemType, number>>
  output: ItemType
  seconds: number
}

export interface EntityDefinition {
  name: string
  abbreviation: string
  cost: number
  power: number
  color: string
  description: string
  recipe?: Recipe
  produces?: ItemType
  cycleSeconds?: number
  terrain?: 'spring' | 'vent' | 'fertile'
}

export interface Entity {
  id: string
  kind: EntityKind
  x: number
  y: number
  orientation: Orientation
  input: Partial<Record<ItemType, number>>
  output: ItemType | null
  items: ItemType[]
  progress: number
  batch: Partial<Record<ItemType, number>> | null
  ripe: boolean
  transit: number
  splitterNext: 0 | 1
  protected?: boolean
}

export type DroneOp =
  | { type: 'MOVE_TO'; x: number; y: number; line: number; text: string }
  | { type: 'HARVEST'; line: number; text: string }
  | { type: 'DROP'; x: number; y: number; amount?: number; line: number; text: string }
  | { type: 'WAIT'; seconds: number; line: number; text: string }
  | { type: 'REPEAT_START'; count: number; end: number; line: number; text: string }
  | { type: 'REPEAT_END'; start: number; line: number; text: string }
  | { type: 'JUMP'; target: number; line: number; text: string }

export interface DroneState {
  x: number
  y: number
  cargo: number
  capacity: number
  source: string
  program: DroneOp[]
  pc: number
  repeatRemaining: Record<string, number>
  path: Point[]
  moveProgress: number
  actionRemaining: number
  actionActivity: DroneActivity
  paused: boolean
  error: string | null
  message: string
  currentLine: number | null
  currentText: string
  distance: number
  programRevision: number
  lastAppliedAt: number
}

export interface MetricSlice {
  start: number
  end: number
  overloaded: boolean
  machineStates: Record<string, MachineStatus>
  shortages: Record<string, string>
  blocked: string[]
  droneActivity: DroneActivity
  delivered: number
}

export interface BaselineMetric {
  throughput: number
  travelFraction: number
  markedAt: number
  programRevision: number
}

export interface VictorySnapshot {
  efficiency: number
  score: number
  completionSeconds: number
  creditsRemaining: number
  travelDistance: number
  discarded: number
  bottlenecks: string[]
}

export interface GameStats {
  produced: number
  producedBy: Record<ItemType, number>
  harvested: number
  initialItems: number
  discarded: number
  delivered: number
  lastDeliveryAt: number | null
  slices: MetricSlice[]
}

export interface GameState {
  version: 1
  scenario: ScenarioMode
  entities: Entity[]
  credits: number
  powerCapacity: number
  simulatedTime: number
  tick: number
  nextEntityId: number
  paused: boolean
  speed: 1 | 2 | 4
  arbitration: Record<string, number>
  drone: DroneState
  stats: GameStats
  victory: VictorySnapshot | null
  victoryAcknowledged: boolean
  baseline: BaselineMetric | null
  notice: string | null
  settings: {
    showCoordinates: boolean
    objectivesCollapsed: boolean
  }
}

export interface AnalysisSnapshot {
  elapsedWindow: number
  coreRate: number
  throughput: number
  powerStability: number
  retention: number
  efficiency: number
  warmingUp: boolean
  travelFraction: number
  machineDurations: Record<string, Record<MachineStatus, number>>
  diagnoses: Array<{ entityId?: string; text: string; seconds?: number }>
}
