# Talent Combinator

Generate all valid WoW talent builds matching your constraints, exported as SimulationCraft profilesets.

## What it does

Talent Combinator explores the full space of valid talent configurations for any World of Warcraft specialization. Set constraints on individual talents (always, never, or conditional), and the app enumerates every legal build that satisfies them. Results export directly as SimC profilesets for batch simming on [Raidbots](https://www.raidbots.com/).

## Features

- **Three constraint types** -- Always (must take), Never (must skip), Conditional (take only when another talent is selected)
- **Live build counting** -- See the number of matching builds update instantly as you add constraints
- **Validation** -- Detects impossible constraint combinations (unreachable nodes, budget overflows, gate violations) before you generate
- **Import talent hash** -- Paste a WoW talent string to auto-set every talent as a constraint
- **Two export formats** -- SimC entry-based profilesets or full talent hash strings
- **Save/Load** -- Persist constraint sets to disk and reload them later
- **Three independent trees** -- Class, spec, and hero talents are counted and generated separately; total builds = product of per-tree counts

## Getting started

**Download** a pre-built release from [GitHub Releases](https://github.com/taherbert/talent-combinator/releases), or build from source:

```bash
git clone https://github.com/taherbert/talent-combinator.git
cd talent-combinator
npm install
npm run dev
```

## Building from source

Prerequisites: [Node.js](https://nodejs.org/) 20+

```bash
npm install          # Install dependencies
npm run dev          # Start dev mode with HMR
npm run build        # Production build
npm run package      # Package as distributable (dmg/exe/AppImage)
```

## How it works

Each of the three talent trees (class, spec, hero) is counted independently using a **polynomial dynamic programming** algorithm that processes nodes tier-by-tier. Ancestor dependencies are tracked via a compact bitmap with dynamic bit assignment and retirement, keeping the state space small (typically 7--10 simultaneous bits instead of 30--40 total ancestors).

Build generation uses **suffix-DP unranking**: a reverse-pass suffix table is computed once, then individual builds are extracted by index in O(n) time per build. When the total exceeds the output limit, builds are sampled at evenly-spaced indices across the full space.

The solver runs in a Web Worker to keep the UI responsive. Counting is sub-millisecond for all specs, so it runs on the main thread for instant feedback.

## Acknowledgments

- [Raidbots](https://www.raidbots.com/) for the talent data API
- [Talent Tree Manager](https://www.raidbots.com/simbot/talents) by Raidbots for UI inspiration
- [simc-talent-generator](https://github.com/vituscze/simc-talent-generator) by Norrinir for inspiration

## License

[MIT](LICENSE)
