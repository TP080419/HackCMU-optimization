# XenoFlow status

## V2 core implemented

- Git `v1.0` tag protects the original vertical slice; active branch is `v2-core`.
- Phaser 4.2.1 full-screen 30×18 isometric Sector 01 with camera drag, zoom, focus and responsive cover framing.
- Original bright alien agriculture art direction, four crop stages, animated Drone, dual-lane items, Inserters and silhouette-distinct machines.
- Deterministic 100ms `SimulationStateV2` with machine buffers, crop speed variation, mixed Cargo, explicit commands/events and render snapshots.
- Whitelist Python-like tokenizer / AST / interpreter with variables, control flow, functions, action yielding, budgets and host-environment isolation.
- CodeMirror 6 workbench with highlighting, completion, execution line, inline diagnostics, stepping and watches.
- Five-phase Sector 01 progression, unlock-scoped hotbar, movable layout, Flow Vision, snapshot Benchmark, final stability gate and Sandbox unlock.
- V2-only save namespace, settings, mute/volume/reduced-motion, local synthesized feedback and no runtime network dependencies.

## Verified

- `npm run typecheck`: passing.
- `npm test`: 47/47 passing, including all 21 frozen V1 tests.
- V2 tests cover parser isolation, deterministic action yielding, cooperative infinite loops and busy-loop rejection, save/load continuation, long-frame tick retention, code and layout improvements, directional player-built logistics, mandatory machine Inserters, multi-tile collision, world-edit feedback, actual `need()` execution, explicit tutorial Inserter gating, benchmark non-mutation, exact optimization thresholds and 300 Belt / 600 item stress.
- `npm run build`: passing; launch entry is split from Phaser and CodeMirror chunks.
- Playwright production checks passed at 1440×900, 1366×768 and 1589×1239 for launch, full world, 58/42 code drawer, first feedback, phase progression, Flow Vision and Benchmark.
- Real-browser phase 3 remained inert with zero Cores until both glowing Inserter slots were built; the second Inserter unlocked phase 4 and production.
- Reload/Continue restores the V2 save. Browser console reports zero errors and zero warnings.
- All observed production requests were local `127.0.0.1` assets; there were no external runtime requests or missing resources.
- Benchmark observed from one live snapshot: fixed patrol 4 Core/min vs demand-driven 5.5 Core/min; output +37.5%, empty travel 11.6% vs 0%.
- Real-browser 300 Belt / 600 moving-item stress held a measured 30.5 render frames/s while the 4× simulation clock retained its fixed ticks.
