# @geniigotchi/guidance

Template guidance documents and documentation for the orchestrator system.

## Overview

The guidance system provides structured documents that define an AI agent's identity, behavior, and capabilities. These documents are loaded by the orchestrator and used to configure agents.

## Guidance Folder Structure

```
guidance/
├── SOUL.md              # Core identity and values
├── INSTRUCTIONS.md      # Behavioral guidelines
├── tasks/               # Task definitions
│   └── *.md
├── skills/              # Skill bundles
│   └── skill-name/
│       ├── README.md
│       └── artifacts/
└── memories/            # Persistent storage
    ├── *.md             # Markdown memories
    └── .system/         # JSON state
        └── *.json
```

## Documents

### SOUL.md

The soul document defines the agent's core identity, values, and personality. This is the most fundamental document and shapes all agent behavior.

See [docs/soul.md](./docs/soul.md) for detailed documentation.

### INSTRUCTIONS.md

The instructions document provides specific behavioral guidelines, constraints, and operating procedures for the agent.

See [docs/instructions.md](./docs/instructions.md) for detailed documentation.

### Tasks

Tasks are specific goals or objectives that can be assigned to an agent. Each task is a markdown file in the `tasks/` directory.

See [docs/tasks.md](./docs/tasks.md) for detailed documentation.

### Skills

Skills are reusable capabilities that can be loaded by an agent. Each skill is a directory containing a README.md and optional artifacts.

See [docs/skills.md](./docs/skills.md) for detailed documentation.

### Memories

The memory system provides persistent storage for agents to maintain state across sessions.

See [docs/memories.md](./docs/memories.md) for detailed documentation.

## Templates

The `templates/` directory contains starter templates for creating your own guidance documents:

- `templates/SOUL.md` - Template soul document
- `templates/INSTRUCTIONS.md` - Template instructions
- `templates/tasks/example-task.md` - Example task definition
- `templates/skills/example-skill/README.md` - Example skill

## Usage

1. Copy the templates to your project's guidance directory
2. Customize the documents for your use case
3. Configure the orchestrator to use your guidance path

```typescript
import { createCoordinator, createPiAdapter } from "@geniigotchi/orchestrator";

const coordinator = createCoordinator({
  adapter: createPiAdapter({ provider: "anthropic", model: "claude-3-5-sonnet-20241022" }),
  defaultGuidancePath: "./my-guidance",
});

await coordinator.start();

const agent = await coordinator.spawn({
  guidancePath: "./my-guidance",
  task: "example-task",
  input: { message: "Hello!" },
  tools: myToolRegistry,
});
```
