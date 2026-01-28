# Geniigotchi

A monorepo built with Turborepo, TypeScript, and Tauri.

## Structure

```
geniigotchi/
├── apps/
│   └── desktop/          # Tauri desktop application
└── shared/
    ├── lib/              # Shared library package
    └── orchestrator/     # Orchestration utilities package
```

## Prerequisites

- [pnpm](https://pnpm.io/) - Package manager
- [Turbo](https://turbo.build/) - Build system
- [Node.js](https://nodejs.org/) - Runtime (v18+ recommended)
- [Rust](https://www.rust-lang.org/) - For Tauri desktop app

## Installation

```bash
# Install dependencies for all packages
pnpm install
```

## Development Commands

All commands should be run from the root using `pnpm` or `turbo`.

### Run all checks (linting + formatting)

```bash
pnpm check
# or
turbo run check
```

### Auto-fix linting and formatting issues

```bash
pnpm check:fix
# or
turbo run check:fix
```

### Development mode

Starts development servers for all packages that support it:

```bash
pnpm dev
# or
turbo run dev
```

### Build all packages

```bash
pnpm build
# or
turbo run build
```

## Individual Package Commands

### Desktop App (Tauri)

```bash
# Run development server
cd apps/desktop
pnpm dev

# Build for production
cd apps/desktop
pnpm build

# Tauri CLI commands
cd apps/desktop
pnpm tauri <command>
```

### Shared Lib

```bash
cd shared/lib

# Type check
pnpm check

# Auto-fix issues
pnpm check:fix

# Build
pnpm build

# Watch mode
pnpm dev
```

### Shared Orchestrator

```bash
cd shared/orchestrator

# Type check
pnpm check

# Auto-fix issues
pnpm check:fix

# Build
pnpm build

# Watch mode
pnpm dev
```

## Code Quality

This project uses [Biome](https://biomejs.dev/) for:

- Linting
- Formatting
- Import organization

Configuration is in `biome.json` at the root. All packages use this single config.

## Turborepo

This project uses Turborepo for:

- Task orchestration
- Caching
- Remote cache (optional, configured in `turbo.json`)

Available tasks: `build`, `check`, `check:fix`, `dev`

See `turbo.json` for configuration.
