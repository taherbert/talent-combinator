# Talent Combinator

Electron desktop app for generating WoW SimulationCraft talent profilesets. Enumerates valid talent combinations based on user constraints and exports SimC-compatible profileset strings.

## Tech Stack

- **Runtime**: Electron 33.x + Node.js
- **Language**: TypeScript 5.7+ (strict mode)
- **Build**: Vite 6.x + electron-vite
- **UI**: Vanilla TS + DOM + SVG (no framework)
- **State**: Custom pub/sub event emitter
- **Test**: Vitest (unit) + Playwright (E2E)
- **Package**: electron-builder

## Project Structure

```
src/
├── main/           # Electron main process (data fetch, cache, IPC)
├── preload/        # Context bridge (IPC API)
├── renderer/       # Renderer process (UI, SVG talent tree, state)
├── worker/         # Web Worker (DFS solver engine)
└── shared/         # Shared types and constants
```

## Key Commands

```bash
npm run dev          # Start dev mode with HMR
npm run build        # Build for production
npm run test         # Run Vitest unit tests
npm run lint         # TypeScript type checking
```

## Architecture Notes

- Talent data fetched from `https://mimiron.raidbots.com/static/data/live/talents.json`
- Solver runs in a Web Worker to keep UI responsive
- SimC export format: `profileset."name"=tree_talents=entry_id:points/...`
- Max 6,399 profilesets per Raidbots batch
- Three independent trees (class, spec, hero) — total combos = product of per-tree combos

## Conventions

- No UI framework — each view is a class managing its own DOM subtree
- SVG for talent tree rendering, DOM for everything else
- Prefer platform/native APIs over libraries
