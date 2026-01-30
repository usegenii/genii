# Geniigotchi

A monorepo built with Turborepo, TypeScript, and Tauri.

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Providers and Models

Create the configuration directory:

```bash
mkdir -p ~/.config/geniigotchi/guidance
```

Create `~/.config/geniigotchi/providers.toml`:

```toml
[anthropic]
type = "anthropic"
base-url = "https://api.anthropic.com"
credential = "secret:anthropic-api-key"
```

Create `~/.config/geniigotchi/models.toml`:

```toml
[sonnet]
provider = "anthropic"
model-id = "claude-sonnet-4-20250514"
thinking-level = "low"

[opus]
provider = "anthropic"
model-id = "claude-opus-4-5-20251101"
thinking-level = "medium"
```

### 3. Store Your API Key

On macOS, store your API key in the system keychain:

```bash
security add-generic-password -s geniigotchi -a anthropic-api-key -w "sk-ant-your-key-here"
```

On Linux, create a secrets file at `~/.config/geniigotchi/secrets.json`:

```json
{
  "anthropic-api-key": "sk-ant-your-key-here"
}
```

### 4. Create Minimal Guidance

Create `~/.config/geniigotchi/guidance/SOUL.md`:

```markdown
You are a helpful assistant.
```

### 5. Start the Daemon

```bash
# Start in foreground for debugging
cd apps/daemon && pnpm tsx src/index.ts --log-level debug

# Or start via CLI (runs in background)
cd apps/cli && pnpm tsx bin/genii.ts daemon start
```

### 6. Spawn an Agent

```bash
cd apps/cli && pnpm tsx bin/genii.ts agent spawn --model anthropic/sonnet "Hello, world!"
```

### 7. List Agents

```bash
cd apps/cli && pnpm tsx bin/genii.ts agent list
```

---

## Structure

```
geniigotchi/
├── apps/
│   ├── cli/              # Command-line interface
│   ├── daemon/           # Background daemon process
│   └── desktop/          # Tauri desktop application
└── shared/
    ├── comms/            # Communication channels (Telegram, Discord, etc.)
    ├── config/           # Configuration loading and secret management
    ├── lib/              # Shared library package
    ├── models/           # Model factory (bridges config to adapters)
    └── orchestrator/     # Agent orchestration and coordination
```

## Configuration

### Model Identifiers

Models are referenced using the format `provider/model-name`. For example:
- `anthropic/sonnet` - References the `sonnet` model configured under the `anthropic` provider
- `anthropic/opus` - References the `opus` model configured under the `anthropic` provider

### Configuration Files

All configuration files are stored in `~/.config/geniigotchi/` (Linux/macOS) or `%APPDATA%/geniigotchi/` (Windows).

| File | Description |
|------|-------------|
| `providers.toml` | Provider configurations (API endpoints, credentials) |
| `models.toml` | Model configurations (provider reference, model ID, thinking level) |
| `channels.toml` | Communication channel configurations |
| `preferences.toml` | User preferences |
| `guidance/SOUL.md` | Default agent personality/instructions |

### Thinking Levels

For Anthropic models, you can configure the thinking level:
- `off` - No extended thinking
- `minimal` - Minimal thinking
- `low` - Low thinking budget
- `medium` - Medium thinking budget (default for Anthropic)
- `high` - High thinking budget

OpenAI and Google models only support `off`.

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
