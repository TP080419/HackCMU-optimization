import { SIM_STEP_MS } from './config'
import { advanceSimulation, applyGameCommand, createInitialState, createRenderSnapshot } from './simulation'
import type { GameCommand, RenderSnapshot, SimulationStateV2 } from './types'

export type EngineListener = (state: SimulationStateV2, snapshot: RenderSnapshot) => void

export class XenoFlowEngine {
  private state: SimulationStateV2
  private accumulator = 0
  private listeners = new Set<EngineListener>()

  constructor(initialState = createInitialState()) {
    this.state = initialState
  }

  getState() {
    return this.state
  }

  snapshot() {
    return createRenderSnapshot(this.state)
  }

  subscribe(listener: EngineListener) {
    this.listeners.add(listener)
    listener(this.state, this.snapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispatch(command: GameCommand) {
    let changed = true
    if (command.type === 'loadState') {
      this.state = command.state
      this.accumulator = 0
    } else if (command.type === 'advance') {
      const tickBefore = this.state.tick
      if (!this.state.paused) {
        this.accumulator += Math.min(250, Math.max(0, command.elapsedMs)) * this.state.speed
        while (this.accumulator >= SIM_STEP_MS) {
          advanceSimulation(this.state, SIM_STEP_MS)
          this.accumulator -= SIM_STEP_MS
        }
      }
      changed = this.state.tick !== tickBefore
    } else {
      this.state = applyGameCommand(this.state, command)
    }
    if (!changed) return
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(this.state, snapshot)
  }
}
