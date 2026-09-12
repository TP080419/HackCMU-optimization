import type { BuildableKind, EntityDefinition, ItemType, Orientation, Point } from './types'

export const MAP_WIDTH = 24
export const MAP_HEIGHT = 14
export const TILE_SIZE = 32
export const STEP_SECONDS = 0.1
export const STARTING_CREDITS = 500
export const BASE_POWER_CAPACITY = 120
export const VICTORY_CORES = 6

export const ITEM_LABELS: Record<ItemType, string> = {
  xenograin: 'Xenograin',
  water: 'Water',
  crystite: 'Crystite',
  gel: 'Nutrient Gel',
  biofiber: 'Biofiber',
  core: 'Terraform Core',
}

export const ITEM_COLORS: Record<ItemType, string> = {
  xenograin: '#99D94C',
  water: '#27C7D9',
  crystite: '#A879FF',
  gel: '#FFB84D',
  biofiber: '#FF7A6E',
  core: '#D7FFF1',
}

export const DEFINITIONS: Record<BuildableKind, EntityDefinition> = {
  belt: { name: 'Belt', abbreviation: '›', cost: 1, power: 0, color: '#5f7d86', description: 'Carries one item at one tile per second.' },
  splitter: { name: 'Splitter', abbreviation: 'Y', cost: 8, power: 0, color: '#76939b', description: 'Alternates front and right outputs.' },
  crate: { name: 'Storage Crate', abbreviation: 'CR', cost: 15, power: 1, color: '#b28a58', description: 'FIFO storage for 20 items.' },
  crop: { name: 'Crop Plot', abbreviation: 'XP', cost: 10, power: 1, color: '#527e39', description: 'Grows one Xenograin every 6 seconds.', cycleSeconds: 6, produces: 'xenograin', terrain: 'fertile' },
  waterExtractor: { name: 'Water Extractor', abbreviation: 'WE', cost: 35, power: 10, color: '#198ca0', description: 'Produces Water every 3 seconds on a spring.', cycleSeconds: 3, produces: 'water', terrain: 'spring' },
  crystiteDrill: { name: 'Crystite Drill', abbreviation: 'CD', cost: 45, power: 15, color: '#7654be', description: 'Produces Crystite every 4 seconds on a vent.', cycleSeconds: 4, produces: 'crystite', terrain: 'vent' },
  gelRefinery: {
    name: 'Gel Refinery', abbreviation: 'GR', cost: 60, power: 20, color: '#b47b2c', description: '2 Xenograin + 1 Water → 1 Nutrient Gel in 6 seconds.',
    recipe: { inputs: { xenograin: 2, water: 1 }, output: 'gel', seconds: 6 },
  },
  fiberMill: {
    name: 'Fiber Mill', abbreviation: 'FM', cost: 65, power: 20, color: '#b45550', description: '1 Xenograin + 2 Crystite → 1 Biofiber in 8 seconds.',
    recipe: { inputs: { xenograin: 1, crystite: 2 }, output: 'biofiber', seconds: 8 },
  },
  coreAssembler: {
    name: 'Core Assembler', abbreviation: 'CA', cost: 100, power: 30, color: '#83bbaa', description: '2 Gel + 1 Biofiber → 1 Terraform Core in 12 seconds.',
    recipe: { inputs: { gel: 2, biofiber: 1 }, output: 'core', seconds: 12 },
  },
  solarPylon: { name: 'Solar Pylon', abbreviation: 'SP', cost: 50, power: 0, color: '#e0bd4f', description: 'Adds 60 global power capacity.' },
}

export const BUILD_ORDER: BuildableKind[] = [
  'belt', 'splitter', 'crate', 'crop', 'waterExtractor', 'crystiteDrill',
  'gelRefinery', 'fiberMill', 'coreAssembler', 'solarPylon',
]

export const TERRAIN = {
  spring: { x: 9, y: 2 },
  vent: { x: 15, y: 9 },
  uplink: { x: 22, y: 6 },
  fertile: [
    { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 },
    { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 },
    { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 },
  ],
  rocks: [
    { x: 7, y: 3 }, { x: 7, y: 4 }, { x: 7, y: 8 },
    { x: 8, y: 8 }, { x: 16, y: 4 }, { x: 17, y: 4 },
    { x: 18, y: 8 }, { x: 18, y: 9 }, { x: 5, y: 10 },
  ],
} satisfies Record<string, Point | Point[]>

export interface FixturePlacement {
  kind: BuildableKind
  x: number
  y: number
  orientation: Orientation
}

export const FACTORY_FIXTURE: FixturePlacement[] = [
  { kind: 'crop', x: 3, y: 3, orientation: 0 },
  { kind: 'crop', x: 4, y: 3, orientation: 0 },
  { kind: 'crop', x: 5, y: 3, orientation: 0 },
  { kind: 'crop', x: 6, y: 3, orientation: 0 },
  { kind: 'waterExtractor', x: 9, y: 2, orientation: 1 },
  { kind: 'belt', x: 9, y: 3, orientation: 1 },
  { kind: 'belt', x: 9, y: 4, orientation: 1 },
  { kind: 'belt', x: 9, y: 5, orientation: 1 },
  { kind: 'gelRefinery', x: 9, y: 6, orientation: 0 },
  { kind: 'belt', x: 10, y: 6, orientation: 0 },
  { kind: 'belt', x: 11, y: 6, orientation: 0 },
  { kind: 'crystiteDrill', x: 15, y: 9, orientation: 2 },
  { kind: 'belt', x: 14, y: 9, orientation: 2 },
  { kind: 'belt', x: 13, y: 9, orientation: 2 },
  { kind: 'fiberMill', x: 12, y: 9, orientation: 3 },
  { kind: 'belt', x: 12, y: 8, orientation: 3 },
  { kind: 'belt', x: 12, y: 7, orientation: 3 },
  { kind: 'coreAssembler', x: 12, y: 6, orientation: 0 },
  { kind: 'belt', x: 13, y: 6, orientation: 0 },
  { kind: 'belt', x: 14, y: 6, orientation: 0 },
  { kind: 'belt', x: 15, y: 6, orientation: 0 },
  { kind: 'belt', x: 16, y: 6, orientation: 0 },
  { kind: 'belt', x: 17, y: 6, orientation: 0 },
  { kind: 'belt', x: 18, y: 6, orientation: 0 },
  { kind: 'belt', x: 19, y: 6, orientation: 0 },
  { kind: 'belt', x: 20, y: 6, orientation: 0 },
  { kind: 'belt', x: 21, y: 6, orientation: 0 },
]

export const DEMO_SHORT_PROGRAM = `# Efficient route: same useful work, no sightseeing
LOOP
  MOVE_TO 3 3
  HARVEST
  MOVE_TO 4 3
  HARVEST
  MOVE_TO 5 3
  HARVEST
  MOVE_TO 6 3
  HARVEST
  MOVE_TO 8 6
  DROP 9 6 4
  MOVE_TO 3 3
  HARVEST
  MOVE_TO 11 9
  DROP 12 9 1
END`

export const DEMO_BASELINE_PROGRAM = `# Baseline route: the two marked trips are needless detours
LOOP
  MOVE_TO 3 3
  HARVEST
  MOVE_TO 4 3
  HARVEST
  MOVE_TO 5 3
  HARVEST
  MOVE_TO 6 3
  HARVEST
  MOVE_TO 8 6
  DROP 9 6 4
  MOVE_TO 2 12
  MOVE_TO 3 3
  HARVEST
  MOVE_TO 11 9
  DROP 12 9 1
  MOVE_TO 20 12
END`

export const NEW_FACTORY_STARTER_PROGRAM = `# Edit these coordinates after placing your factory.
LOOP
  MOVE_TO 3 3
  HARVEST
  MOVE_TO 8 6
  DROP 9 6
  WAIT 1
END`

export const DIRECTION_VECTORS: Record<Orientation, Point> = {
  0: { x: 1, y: 0 },
  1: { x: 0, y: 1 },
  2: { x: -1, y: 0 },
  3: { x: 0, y: -1 },
}

export const RAW_PER_CORE = { xenograin: 5, water: 2, crystite: 2 } as const

export function fixtureCost(): number {
  return FACTORY_FIXTURE.reduce((sum, placement) => sum + DEFINITIONS[placement.kind].cost, 0)
}

export function pointKey(x: number, y: number): string {
  return `${x},${y}`
}

export function isPointIn(points: Point[], x: number, y: number): boolean {
  return points.some((point) => point.x === x && point.y === y)
}
