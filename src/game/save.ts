import type { GameState, ScenarioMode } from './types'

export const SAVE_KEY = 'xenoflow.save.v1'
export const BEST_KEY = 'xenoflow.best.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface BestResults {
  demo?: { score: number; seconds: number; savedAt: string }
  new?: { score: number; seconds: number; savedAt: string }
}

export type LoadResult =
  | { ok: true; state: GameState }
  | { ok: false; kind: 'missing' | 'corrupt' | 'unsupported' | 'storage'; message: string; raw?: string }

function isScenario(value: unknown): value is ScenarioMode {
  return value === 'demo' || value === 'new'
}

const ENTITY_KINDS = new Set(['belt', 'splitter', 'crate', 'crop', 'waterExtractor', 'crystiteDrill', 'gelRefinery', 'fiberMill', 'coreAssembler', 'solarPylon', 'uplink'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isValidGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<GameState>
  return state.version === 1
    && isScenario(state.scenario)
    && Array.isArray(state.entities)
    && state.entities.every((entity) => isRecord(entity)
      && typeof entity.id === 'string'
      && ENTITY_KINDS.has(String(entity.kind))
      && typeof entity.x === 'number'
      && typeof entity.y === 'number'
      && Array.isArray(entity.items))
    && typeof state.credits === 'number'
    && typeof state.simulatedTime === 'number'
    && typeof state.tick === 'number'
    && typeof state.nextEntityId === 'number'
    && isRecord(state.drone)
    && typeof state.drone.source === 'string'
    && Array.isArray(state.drone.program)
    && typeof state.drone.x === 'number'
    && typeof state.drone.y === 'number'
    && isRecord(state.stats)
    && Array.isArray(state.stats.slices)
    && isRecord(state.stats.producedBy)
    && typeof state.stats.harvested === 'number'
    && typeof state.stats.delivered === 'number'
    && isRecord(state.settings)
}

export function serializeState(state: GameState): string {
  return JSON.stringify(state)
}

export function deserializeState(raw: string): LoadResult {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'version' in parsed && (parsed as { version?: unknown }).version !== 1) {
      return { ok: false, kind: 'unsupported', message: 'This save was created by an unsupported XenoFlow version.', raw }
    }
    if (!isValidGameState(parsed)) return { ok: false, kind: 'corrupt', message: 'The save data is incomplete or corrupt.', raw }
    parsed.paused = true
    parsed.notice = 'Save restored in paused mode.'
    return { ok: true, state: parsed }
  } catch {
    return { ok: false, kind: 'corrupt', message: 'The save data is not valid JSON.', raw }
  }
}

export function saveGame(storage: StorageLike, state: GameState): { ok: true } | { ok: false; message: string } {
  try {
    storage.setItem(SAVE_KEY, serializeState(state))
    return { ok: true }
  } catch (error) {
    return { ok: false, message: `Could not save progress: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function loadGame(storage: StorageLike): LoadResult {
  let raw: string | null
  try {
    raw = storage.getItem(SAVE_KEY)
  } catch (error) {
    return { ok: false, kind: 'storage', message: `Could not read progress: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!raw) return { ok: false, kind: 'missing', message: 'No saved factory found.' }
  return deserializeState(raw)
}

export function clearSave(storage: StorageLike): { ok: true } | { ok: false; message: string } {
  try {
    storage.removeItem(SAVE_KEY)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: `Could not clear the save: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export function readBestResults(storage: StorageLike): BestResults {
  try {
    const raw = storage.getItem(BEST_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as BestResults
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function recordBest(storage: StorageLike, state: GameState): { ok: true; results: BestResults } | { ok: false; message: string } {
  if (!state.victory) return { ok: false, message: 'A result can only be recorded after victory.' }
  const results = readBestResults(storage)
  const previous = results[state.scenario]
  if (!previous || state.victory.score > previous.score) {
    results[state.scenario] = {
      score: state.victory.score,
      seconds: state.victory.completionSeconds,
      savedAt: new Date().toISOString(),
    }
  }
  try {
    storage.setItem(BEST_KEY, JSON.stringify(results))
    return { ok: true, results }
  } catch (error) {
    return { ok: false, message: `Could not record best result: ${error instanceof Error ? error.message : String(error)}` }
  }
}
