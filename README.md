# XenoFlow

XenoFlow is a desktop browser game about alien farming, factory logistics, and one programmable harvesting drone. Build a complete production chain, watch every item travel through it, use measured bottleneck evidence, and deliver six Terraform Cores without exceeding the construction budget.

The game is a local-only vertical slice: one fixed 24×14 map, **Instant Demo**, unsolved **New Factory**, a safe drone language, 60-second analyzer, victory scoring, and save/continue. Gameplay makes no network requests.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To run the exact production output:

```bash
npm run build
npm run preview
```

Verification commands:

```bash
npm run typecheck
npm test
npm run build
```

## How to play

- Choose a building in the bottom palette, then click a valid tile. Drag to place a straight Belt run.
- Water Extractors require the cyan Hydro Spring; Crystite Drills require the violet vent; Crop Plots require fertile ground.
- Face a machine's output toward the next Belt. Machines receive compatible ingredients from their other three sides.
- Open **Drone**, update the coordinates to match your layout, then choose **Apply & Run**.
- Open **Analyzer** after the factory has run long enough. It reports measured shortages, blocked transfers, throughput, power stability, retention, and drone travel share.
- Deliver six Terraform Cores to the protected Uplink.

Keyboard controls:

| Key | Action |
| --- | --- |
| `R` | Rotate the active build tool or selected entity |
| `Esc` | Cancel the active build/demolish tool |
| `Space` | Pause or resume global simulation |
| `1`, `2`, `4` | Run at 1×, 2×, or 4× |

Shortcuts are disabled while typing in the drone editor. Construction, inspection, and code editing remain available while the simulation is paused.

## Production chain

There are exactly six item types: Xenograin, Water, Crystite, Nutrient Gel, Biofiber, and Terraform Core.

| Machine | Recipe |
| --- | --- |
| Crop Plot | 1 Xenograin every 6s; remains ripe until harvested |
| Water Extractor | 1 Water every 3s |
| Crystite Drill | 1 Crystite every 4s |
| Gel Refinery | 2 Xenograin + 1 Water → 1 Nutrient Gel in 6s |
| Fiber Mill | 1 Xenograin + 2 Crystite → 1 Biofiber in 8s |
| Core Assembler | 2 Gel + 1 Biofiber → 1 Terraform Core in 12s |

One Core therefore requires **5 Xenograin, 2 Water, and 2 Crystite**. All costs, power values, recipes, map coordinates, and shipped programs are centralized in `src/game/config.ts`.

Installed power demand is always counted. When demand exceeds capacity, crop and machine speed is multiplied by `capacity / demand`; Belts and the drone retain their normal speed. A Solar Pylon adds 60 capacity.

## Drone language

The language is case-insensitive, ignores `# comments`, and is parsed into instructions; it never evaluates JavaScript.

```text
LOOP
  MOVE_TO 3 3
  HARVEST
  MOVE_TO 8 6
  DROP 9 6 4
  WAIT 1
END
```

| Command | Meaning |
| --- | --- |
| `MOVE_TO x y` | Fly by deterministic N/E/S/W BFS at one tile per second |
| `HARVEST` | Harvest the Crop Plot under the drone |
| `DROP x y [amount]` | Drop up to 1–4 Xenograin into an adjacent compatible input |
| `WAIT seconds` | Wait 0.1–60 simulated seconds |
| `REPEAT count … END` | Repeat a block 1–100 times |
| `LOOP … END` | Repeat a block forever |

Limits are 200 source lines, nesting depth 4, and 64 zero-time control operations per tick. Errors identify the source line and pause only the drone. Applying a program preserves position and cargo; Reset additionally preserves source while clearing runtime state.

## Analyzer and score

The analyzer aggregates simulation events over the most recent 60 simulated seconds (or the actual shorter duration while warming up). It does not use animation frames or scripted bonuses.

```text
elapsedWindow = min(60, simulatedSeconds)
coreRate = deliveredInWindow × 60 / elapsedWindow
throughput = clamp(coreRate / 2, 0, 1)
powerStability = 1 - overloadedSecondsInWindow / elapsedWindow
retention = clamp(1 - discarded / max(1, initialItems + producedItems), 0, 1)
efficiency = 100 × throughput × (0.8 + 0.1 × powerStability + 0.1 × retention)
```

Retention is an item-event proxy, not physical mass balance. Machine utilization is informational and does not reduce the score merely because an upstream machine correctly idles.

At the first six-Core delivery:

```text
finalScore = round(efficiency × 100)
           + 10 × max(0, 360 - floor(completionSeconds))
           + 2 × creditsRemaining
           - 20 × discardedItems
```

Instant Demo and New Factory retain separate local best results. The Demo baseline button stores a temporary measured window; comparison remains in “collecting data” until a later full window excludes all pre-edit events.

## Architecture

- `src/game/config.ts` — canonical economy, recipes, map, fixture, and programs.
- `src/game/simulation.ts` — deterministic 100ms production, transport, power, placement, metrics, and victory rules.
- `src/game/drone.ts` — parser, bytecode-like instructions, BFS, and bounded runtime.
- `src/game/save.ts` — versioned JSON save validation and separate best results.
- `src/rendering/canvas.ts` — 2D world rendering and the five bounded animation families.
- `src/ui/WorldCanvas.tsx` — pointer/grid mapping and straight Belt drag gestures.
- `src/App.tsx` — React controls, fixed-step browser loop, persistence, recovery, and screens.

Simulation state uses stable entity IDs and plain serializable data. Transfer resolution is deterministic: readiness is snapshotted, intents are grouped, one claim wins by rotating priority, then commits occur. A newly arrived Belt item waits a full tile-second and cannot cross two tiles in one step.

## Visual assets and accessibility

The shipped game uses the original geometric Canvas renderer. The approved Kenney Tiny Factory and Tiny Farm packs were each inspected once and verified as CC0, but their warm 16px pixel style was not mixed into the established dark 32px industrial visual language. See `THIRD_PARTY_ASSETS.md`.

Controls use accessible labels, keyboard focus is visible, and critical states pair color with text or shape. Reduced-motion preferences disable decorative movement. The full interface targets 1440×900 and 1366×768; windows below 1180×720 show a desktop-size notice.

## Current limitations

- One fixed map and one drone only; New Factory intentionally has no auto-solver.
- Save data and best results are local to the current browser profile.
- Desktop browser only; there is no touch/mobile layout, backend, leaderboard, multiplayer, audio, zoom, or live deployment in this repository.
- Closed full Belt loops may remain jammed by design.
