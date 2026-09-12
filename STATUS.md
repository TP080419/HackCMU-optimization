# XenoFlow status

## Working

- Complete fixed 24x14 map and centralized economy/recipe configuration.
- Deterministic 100 ms production, power, Belt/Splitter/Crate transport, arbitration, and demolition accounting.
- Safe drone DSL with bounded parser/runtime, deterministic BFS, editor controls, two Demo programs, and runtime diagnostics.
- Canvas world with visible item transport, progress, ports, statuses, drone movement, selection, build ghosts, and Core pulse.
- React HUD, pause/1x/2x/4x, paused construction, rotation, demolition, straight Belt drag, objectives, Help, and responsive desktop notice.
- Rolling 60-second analyzer, Demo baseline/current comparison, scoring, six-Core victory, Retry/Main Menu/Keep Optimizing.
- Versioned save/Continue, separate Demo/New bests, corrupt-save recovery, error boundary, guarded loop, and hidden-page pause.
- README, Demo walkthrough, asset decision, and contributor guidance.

## Verified

- `npm test`: 21/21 tests passing, including complete New Factory and controlled route-comparison fixtures.
- `npm run typecheck`: passing.
- `npm run build`: passing.
- `npm audit --omit=dev`: zero runtime vulnerabilities.
- Browser production-build checks at 1440x900 and 1366x768: menu, Demo transport/edit/speed/analyzer/victory, Keep Optimizing, Retry confirmation, Main Menu, reload/Continue, New Factory paused build, pointer mapping, R/Esc, Belt drag, invalid terrain, protected Uplink, demolition, and final analyzer diagnostics.
- Final browser console: zero errors and zero warnings.
- Representative screenshots captured under ignored `output/playwright/`.
- Kenney Tiny Factory and Tiny Farm official archives each inspected once; both CC0, geometric fallback selected.

## Unresolved

- No known local failures.
- Remote delivery is verified separately by comparing the pushed `main` SHA.

## Key files

- `src/game/config.ts` - canonical map and economy configuration.
- `src/game/simulation.ts` - deterministic simulation.
- `src/game/drone.ts` - safe DSL and runtime.
- `src/App.tsx` - playable shell.

## Next action

- No further implementation work is required; follow `README.md` to run or extend the game.
