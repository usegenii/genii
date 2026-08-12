# Genii

An autonomous AI agent platform that runs in the background and maintains persistent conversations. Genii can be
reached through Telegram today, with platform-neutral contracts for adding more messaging integrations.

## Features

- **Persistent Agents**: AI agents that maintain conversation history and context across sessions
- **Telegram Integration**: Connect agents to the currently implemented messaging channel
- **Configurable Models**: Configure named built-in or custom providers through supported API protocols
- **Guidance System**: Customize agent personality and behavior through markdown files
- **Daemon Runtime**: Keeps agent state and integrations in a long-running process
- **CLI Control**: Inspect and operate agents, the daemon, and configuration from the command line

## Quick Start

This workflow is verified from a fresh source checkout using a POSIX shell. Run every command from the repository root.
A packaged install exposes `genii` and `genii-daemon`; the tracked `node bin/...` wrappers below invoke those same built
entry points from source.

### 1. Install and Build

```bash
pnpm install --frozen-lockfile
pnpm build
```

The build is required before running the source wrappers because workspace package exports resolve through `dist`.

### 2. Find the Configuration and Data Directory

Use the CLI rather than hard-coding a platform path:

```bash
node bin/genii.js config path
```

The installed equivalent is `genii config path`. For scripts, `genii --quiet config path` prints only the directory;
from this source checkout, use:

```bash
node bin/genii.js --quiet config path
```

Genii stores configuration and runtime data together. The defaults are:

| Platform | Default directory |
| --- | --- |
| Linux and other Unix systems | `$XDG_DATA_HOME/genii`, or `~/.local/share/genii` when `XDG_DATA_HOME` is unset |
| macOS | `~/Library/Application Support/genii` |
| Windows | `%APPDATA%\genii`, or `~/AppData/Roaming/genii` when `APPDATA` is unset |

Starting the daemon with an explicit `--data <path>` replaces this default. `config path` reports the default only, so
use the same explicit path for any manual work on a custom data directory.

### 3. Start the Daemon in the Foreground

In terminal 1, run:

```bash
export GENII_SOCKET="${XDG_RUNTIME_DIR:-/tmp}/genii-daemon.sock"
node bin/genii-daemon.js --socket "$GENII_SOCKET" --log-level debug
```

Leave it running. The explicit socket keeps the source daemon and CLI on the same endpoint, including on systems that
set `XDG_RUNTIME_DIR`. The foreground entry point exposes startup failures directly and works in a source checkout.

### 4. Configure a Provider

In terminal 2, provide your Z.ai Coding Plan key through the environment and run non-interactive onboarding:

```bash
export GENII_SOCKET="${XDG_RUNTIME_DIR:-/tmp}/genii-daemon.sock"
export ZAI_API_KEY="<your-zai-api-key>"
node bin/genii.js onboard \
  --non-interactive \
  --accept-disclaimer \
  --provider zai \
  --api-key "$ZAI_API_KEY" \
  --models glm-4.7
```

Provider IDs name configured endpoints, while provider types select an API protocol. This example uses the built-in
Z.ai provider through its OpenAI-compatible API. Provider choices can change by release; run
`node bin/genii.js onboard --help` and use interactive `node bin/genii.js onboard` to see the choices implemented by
your checkout, including custom-provider options.

Onboarding writes configuration, guidance templates, preferences, and the provider credential. Stop the daemon in
terminal 1 with Ctrl+C, then run the foreground command again so it loads the new configuration.

### 5. Verify and Spawn an Agent

```bash
node bin/genii.js daemon status
node bin/genii.js agent spawn --model zai/glm-4.7 "Hello, world!"
node bin/genii.js agent list
```

### How Credentials Are Stored

Genii uses macOS Keychain and Windows Credential Manager directly. On Linux and other platforms, it probes for an
available native secret service and uses it when the probe succeeds. Only when that probe fails does Genii use
`<data-directory>/secrets.json`. An existing fallback file does not override an available native store, and a later
native-store error does not switch the process to the file.

On POSIX systems, the fallback data directory and file must be real paths rather than symbolic links, owned by the
current user, and usable with no group, world, or special permission bits. Genii creates a missing directory with mode
`0700` and a missing file with mode `0600`. Existing ownership and permissions are validation-only: Genii reports an
error instead of changing them. Modes that are stricter usable subsets are accepted, but `0700` and `0600` are the
recommended settings.

Only prepare the JSON fallback manually when native secret storage is unavailable. This snippet uses the CLI-reported
default; if the daemon uses `--data`, replace the first assignment with that explicit path:

```bash
GENII_DATA_DIR="$(node bin/genii.js --quiet config path)"
umask 077
mkdir -p "$GENII_DATA_DIR"
chmod 700 "$GENII_DATA_DIR"
touch "$GENII_DATA_DIR/secrets.json"
chmod 600 "$GENII_DATA_DIR/secrets.json"
```

The fallback is a JSON object keyed by the name after `secret:` in configuration. For the quick-start provider:

```json
{
  "zai-api-key": "<your-zai-api-key>"
}
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

- `zai/glm-4.7` references the `glm-4.7` model configured under the `zai` provider
- `my-provider/my-model` references `my-model` under a custom provider named `my-provider`

The provider portion is the configured endpoint ID; its provider type separately selects the API protocol.

### Configuration Files

Run `genii config path` to locate the default directory and its configuration files. The source-checkout equivalent is
`node bin/genii.js config path`. This base directory also contains runtime data; see the platform table and custom
`--data` caveat in the quick start.

| Path | Description |
| --- | --- |
| `providers.toml` | Provider endpoints, API protocols, and credential references |
| `models.toml` | Provider references, model IDs, and thinking levels |
| `channels.toml` | Communication channel configuration |
| `preferences.toml` | User preferences |
| `guidance/` | Agent personality and instruction files |
| `secrets.json` | Linux/other-platform fallback selected only when the native secret-store probe fails |

#### Shell timeout

`agents.tools.shell.default-timeout` is expressed in milliseconds and defaults to `30000` (30 seconds). Configured
values are interpreted literally as milliseconds.

### Thinking Levels

The accepted thinking-level values are:

- `off` - No extended thinking
- `minimal` - Minimal thinking
- `low` - Low thinking budget
- `medium` - Medium thinking budget
- `high` - High thinking budget

Actual support and defaults depend on the configured provider's API protocol and model. An unsupported requested level
resolves to `off`; omit the setting to use the protocol default. The available onboarding choices, rather than this
generic value list, are the source of truth for providers implemented by a release.

## Prerequisites

- [pnpm](https://pnpm.io/) - Package manager
- [Turbo](https://turbo.build/) - Build system
- [Node.js](https://nodejs.org/) - Runtime (v20+ recommended)
- [Rust](https://www.rust-lang.org/) - For Tauri desktop app (optional)

## Installation

```bash
# Install dependencies for all packages
pnpm install --frozen-lockfile
pnpm build
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
