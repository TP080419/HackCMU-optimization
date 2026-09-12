import { SIM_STEP_MS } from './config'
import { advanceSimulation, applyGameCommand, cloneState } from './simulation'
import type { BenchmarkResult, SimulationStateV2 } from './types'

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function runBenchmark(
  sourceState: SimulationStateV2,
  source: string,
  simulatedMs = 120_000,
): BenchmarkResult {
  const state = cloneState(sourceState)
  const baseline = {
    cores: state.metrics.coresDelivered,
    empty: state.drone.emptyDistance,
    loaded: state.drone.loadedDistance,
    xenograinDistance: state.metrics.xenograinDistance,
    xenograinDelivered: state.metrics.xenograinDelivered,
    refineryStarved: state.metrics.refineryStarvedMs,
    millStarved: state.metrics.millStarvedMs,
    beltBlocked: state.metrics.beltBlockedMs,
    energy: state.metrics.energyUsed,
  }
  state.paused = false
  state.drone.action = null
  applyGameCommand(state, { type: 'loadProgram', source })
  applyGameCommand(state, { type: 'runProgram' })

  for (let elapsed = 0; elapsed < simulatedMs; elapsed += SIM_STEP_MS) {
    advanceSimulation(state, SIM_STEP_MS)
  }

  const cores = state.metrics.coresDelivered - baseline.cores
  const empty = state.drone.emptyDistance - baseline.empty
  const loaded = state.drone.loadedDistance - baseline.loaded
  const travel = empty + loaded
  return {
    id: `benchmark-${sourceState.tick}-${source.length}`,
    simulatedMs,
    coresPerMinute: round(cores * (60_000 / simulatedMs)),
    coresProduced: cores,
    emptyTravelPercent: round(travel > 0 ? (empty / travel) * 100 : 100, 1),
    xenograinDistancePerUnit: round((state.metrics.xenograinDistance - baseline.xenograinDistance) / Math.max(1, state.metrics.xenograinDelivered - baseline.xenograinDelivered)),
    refineryStarvedPercent: round(((state.metrics.refineryStarvedMs - baseline.refineryStarved) / simulatedMs) * 100, 1),
    millStarvedPercent: round(((state.metrics.millStarvedMs - baseline.millStarved) / simulatedMs) * 100, 1),
    beltBlockedPercent: round(((state.metrics.beltBlockedMs - baseline.beltBlocked) / simulatedMs) * 100, 1),
    energyUsed: round(state.metrics.energyUsed - baseline.energy, 3),
    source,
  }
}

export function benchmarkImprovement(before: BenchmarkResult, after: BenchmarkResult) {
  const outputGain = before.coresPerMinute > 0
    ? ((after.coresPerMinute - before.coresPerMinute) / before.coresPerMinute) * 100
    : after.coresPerMinute > 0 ? 100 : 0
  const emptyReduction = before.emptyTravelPercent > 0
    ? ((before.emptyTravelPercent - after.emptyTravelPercent) / before.emptyTravelPercent) * 100
    : 0
  return { outputGain: round(outputGain, 1), emptyReduction: round(emptyReduction, 1) }
}
