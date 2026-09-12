# XenoFlow contributor guide

- Stack: Vite, React, strict TypeScript, Canvas 2D, Vitest.
- Commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`.
- Simulation rules live in `src/game/`; rendering in `src/rendering/`; React UI in `src/ui/`.
- Keep configuration values and fixture coordinates in `src/game/config.ts`.
- State must remain explicit and JSON-serializable. Do not move simulation rules into React.
- Preserve deterministic 100 ms stepping and add focused tests for rule changes.
- Do not launch subagents, change models, or install agent frameworks automatically.
- Update `STATUS.md` only at milestone boundaries; keep it concise.
