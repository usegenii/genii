# Genii

An autonomous AI agent platform that runs in the background, maintaining persistent conversations across multiple channels (Telegram, Discord, etc.). A digital companion that lives on your machine, learns your preferences, and can be reached through various messaging platforms.

## Features

- **Persistent Agents**: AI agents that maintain conversation history and context across sessions
- **Multi-Channel Support**: Connect to Telegram, Discord, and other messaging platforms
- **Configurable Models**: Support for Anthropic, OpenAI, and Google AI models
- **Guidance System**: Customize agent personality and behavior through markdown files
- **Background Daemon**: Runs quietly in the background, always available
- **CLI Control**: Full control over agents, channels, and configuration via command line

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Providers and Models

Create the configuration directory:

```bash
mkdir -p ~/.config/genii/guidance
```

Create `~/.config/genii/providers.toml`:

```toml
[anthropic]
type = "anthropic"
base-url = "https://api.anthropic.com"
credential = "secret:anthropic-api-key"
```

Create `~/.config/genii/models.toml`:

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
security add-generic-password -s genii -a anthropic-api-key -w "sk-ant-your-key-here"
```

On Linux, Genii prefers the system Secret Service through libsecret. If it is unavailable, such as on a headless
host, Genii falls back to `<data-path>/secrets.json`, using the daemon's configured data path. The default data path is
`$XDG_DATA_HOME/genii` when `XDG_DATA_HOME` is set, otherwise `~/.local/share/genii`.

On POSIX systems, Genii accepts the fallback only when the data path is a real directory, not a symbolic link, owned by
the current user, and `secrets.json` is a real regular file, not a symbolic link, owned by the current user. Genii
creates missing directories with mode `0700` and missing secret files with mode `0600`. Existing paths are
validation-only: Genii never changes their mode or ownership, and accepts usable secure modes that are stricter subsets
of `0700` for the directory or `0600` for the file. If an existing mode grants permissions outside those limits, or a path
has an unsafe owner, type, or resolution, Genii fails closed with an actionable error instead of reading or writing
credentials.

Create the default fallback paths securely before adding the JSON. If the daemon uses a custom data path, assign that
path to `GENII_DATA_DIR` instead. For an existing current-user-owned, non-symbolic-link store rejected only because of
its mode, the `chmod` commands below are also the manual remediation:

```bash
GENII_DATA_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/genii"
umask 077
mkdir -p "$GENII_DATA_DIR"
chmod 700 "$GENII_DATA_DIR"
touch "$GENII_DATA_DIR/secrets.json"
chmod 600 "$GENII_DATA_DIR/secrets.json"
```

```json
{
  "anthropic-api-key": "sk-ant-your-key-here"
}
```

### 4. Create Minimal Guidance

Create `~/.config/genii/guidance/SOUL.md`:

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

## Project Structure

```
genii/
├── apps/
│   ├── cli/              # @genii/cli - Command-line interface
│   ├── daemon/           # @genii/daemon - Background daemon process
│   └── desktop/          # Tauri desktop application (WIP)
└── shared/
    ├── comms/            # @genii/comms - Communication channels
    ├── config/           # @genii/config - Configuration and secrets
    ├── guidance/         # @genii/guidance - Template files
    ├── lib/              # @genii/lib - Shared utilities
    ├── models/           # @genii/models - Model factory
    └── orchestrator/     # @genii/orchestrator - Agent orchestration
```

## Configuration

### Model Identifiers

Models are referenced using the format `provider/model-name`. For example:
- `anthropic/sonnet` - References the `sonnet` model configured under the `anthropic` provider
- `anthropic/opus` - References the `opus` model configured under the `anthropic` provider

### Configuration Files

All configuration files are stored in `~/.config/genii/` (Linux/macOS) or `%APPDATA%/genii/` (Windows).

| File | Description |
|------|-------------|
| `providers.toml` | Provider configurations (API endpoints, credentials) |
| `models.toml` | Model configurations (provider reference, model ID, thinking level) |
| `channels.toml` | Communication channel configurations |
| `preferences.toml` | User preferences |
| `guidance/SOUL.md` | Default agent personality/instructions |

#### Shell timeout

`agents.tools.shell.default-timeout` is expressed in milliseconds and defaults to `30000` (30 seconds). Configured
values are interpreted literally as milliseconds.

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
- [Node.js](https://nodejs.org/) - Runtime (v20+ recommended)
- [Rust](https://www.rust-lang.org/) - For Tauri desktop app (optional)

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

## Code Quality

This project uses [Biome](https://biomejs.dev/) for:

- Linting
- Formatting
- Import organization

Configuration is in `biome.json` at the root. All packages use this single config.

## Publishing to npm

### Prerequisites

1. **npm account**: Create an account at https://www.npmjs.com
2. **npm org**: Create the `@genii` organization at https://www.npmjs.com/org/create
3. **Login**: Run `npm login` to authenticate

### Package Overview

| Package | Description |
|---------|-------------|
| `usegenii` | Meta-package (installs CLI + daemon) |
| `@genii/cli` | CLI binary (`genii` command) |
| `@genii/daemon` | Daemon binary (`genii-daemon` command) |
| `@genii/config` | Configuration management |
| `@genii/models` | Model factory |
| `@genii/orchestrator` | Agent orchestration |
| `@genii/comms` | Messaging adapters |
| `@genii/guidance` | Template files |
| `@genii/lib` | Shared utilities |

### Publish All Packages

The `scripts/publish-all.sh` script automates publishing all packages in the correct dependency order. It:

1. Reads the version from the root `package.json` and syncs it to all nested packages
2. Runs pre-publish checks (build, lint, test)
3. Publishes shared packages first (lib, config, comms, orchestrator, guidance)
4. Publishes models (depends on config + orchestrator)
5. Publishes apps (cli, daemon)
6. Publishes the root meta-package (auto-converts `workspace:*` to version numbers)

```bash
# Dry run (test without publishing)
pnpm publish:dry-run

# Publish for real
pnpm publish:all

# Skip pre-publish checks (build, lint, test)
./scripts/publish-all.sh --skip-checks
```

### Version Management

All packages share the same version. To release a new version:

1. Update the version in the root `package.json`
2. Run `pnpm publish:all` (the script auto-syncs the version to all nested packages)
