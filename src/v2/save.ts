import { SAVE_KEY, SETTINGS_KEY } from './config'
import { cloneState, createInitialState } from './simulation'
import type { SimulationStateV2 } from './types'

interface SaveEnvelope {
  schema: 2
  savedAt: string
  state: SimulationStateV2
}

export function isV2State(value: unknown): value is SimulationStateV2 {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SimulationStateV2>
  return candidate.version === 2 && Array.isArray(candidate.entities) && candidate.drone?.id === 'drone-01' && candidate.runtime !== undefined
}

export function saveGame(state: SimulationStateV2, storage: Pick<Storage, 'setItem'> = localStorage) {
  const envelope: SaveEnvelope = { schema: 2, savedAt: new Date().toISOString(), state: cloneState(state) }
  storage.setItem(SAVE_KEY, JSON.stringify(envelope))
  storage.setItem(SETTINGS_KEY, JSON.stringify(state.settings))
}

export function loadGame(storage: Pick<Storage, 'getItem'> = localStorage): SimulationStateV2 | null {
  const raw = storage.getItem(SAVE_KEY)
  if (!raw) return null
  try {
    const envelope = JSON.parse(raw) as Partial<SaveEnvelope>
    if (envelope.schema !== 2 || !isV2State(envelope.state)) return null
    // Forward-fill metrics added within V2 while leaving all V1 keys untouched.
    envelope.state.metrics.xenograinDelivered ??= 0
    return envelope.state
  } catch {
    return null
  }
}

export function loadSettings(storage: Pick<Storage, 'getItem'> = localStorage) {
  const raw = storage.getItem(SETTINGS_KEY)
  if (!raw) return createInitialState().settings
  try {
    const parsed = JSON.parse(raw) as Partial<SimulationStateV2['settings']>
    return {
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : false,
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : 0.55,
      reducedMotion: typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : false,
    }
  } catch {
    return createInitialState().settings
  }
}
