# Memories Documentation

The memory system provides persistent storage for agents to maintain state across sessions, learn from interactions, and build contextual knowledge.

## Overview

Memories are stored in the `memories/` directory within the guidance folder. The system supports two types of storage:

1. **Markdown Files**: For human-readable documents and notes
2. **JSON State**: For structured data and configuration

## Directory Structure

```
guidance/
└── memories/
    ├── notes/
    │   ├── project-context.md
    │   └── user-preferences.md
    ├── logs/
    │   └── session-2024-01-15.md
    └── .system/
        ├── preferences.json
        └── history.json
```

## Memory Types

### Markdown Memories

Free-form documents stored as `.md` files:

```typescript
// Write a memory
await memory.write("notes/project-context.md", `
# Project Context

## Key Decisions
- Chose React for frontend
- Using PostgreSQL for database
`);

// Read a memory
const content = await memory.read("notes/project-context.md");

// Delete a memory
await memory.delete("notes/project-context.md");

// List all memories
const files = await memory.list("notes/*.md");
```

### JSON State

Structured data stored as JSON files in the `.system/` directory:

```typescript
// Set state
await memory.setState("preferences", {
  theme: "dark",
  verbosity: "concise",
});

// Get state
const prefs = await memory.getState<Preferences>("preferences");

// Atomic update
await memory.updateState("counter", (current) => ({
  value: (current?.value ?? 0) + 1,
}));

// List state keys
const keys = await memory.listStateKeys();
```

## API Reference

### MemorySystem Interface

```typescript
interface MemorySystem {
  // Markdown memories
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(pattern?: string): Promise<string[]>;

  // JSON state
  getState<T>(key: string): Promise<T | null>;
  setState<T>(key: string, value: T): Promise<void>;
  updateState<T>(key: string, fn: (current: T | null) => T): Promise<void>;
  listStateKeys(): Promise<string[]>;

  // Events
  onWrite(handler: (path: string, content: string) => void): Disposable;
  onDelete(handler: (path: string) => void): Disposable;
}
```

### Path Resolution

Memory paths are relative to the `memories/` directory:

- `"notes/context.md"` → `guidance/memories/notes/context.md`
- `"session.md"` → `guidance/memories/session.md`

Path traversal (e.g., `"../SOUL.md"`) is prevented for security.

### Glob Patterns

The `list()` method supports simple glob patterns:

- `"*.md"` - All markdown files in root
- `"notes/*.md"` - All markdown files in notes/
- `"**/*.md"` - All markdown files recursively

## Use Cases

### User Preferences

Store learned preferences about the user:

```typescript
await memory.updateState("user", (current) => ({
  ...current,
  preferredLanguage: "TypeScript",
  communicationStyle: "concise",
}));
```

### Session History

Track important information across sessions:

```typescript
await memory.write(`logs/session-${sessionId}.md`, `
# Session ${sessionId}

## Topics Discussed
- Project architecture
- Database design

## Key Decisions
- Use PostgreSQL
- Implement caching layer

## Follow-up Items
- Research Redis options
- Create schema diagrams
`);
```

### Project Context

Maintain understanding of ongoing projects:

```typescript
await memory.write("projects/main.md", `
# Main Project

## Overview
Building a customer portal application.

## Technology Stack
- Frontend: React + TypeScript
- Backend: Node.js + Express
- Database: PostgreSQL

## Current Status
Working on authentication module.

## Recent Changes
- Added OAuth support
- Implemented session management
`);
```

## Checkpointing

Memory writes are tracked for checkpointing:

```typescript
// Subscribe to changes
const dispose = memory.onWrite((path, content) => {
  console.log(`Memory updated: ${path}`);
});

// Clean up when done
dispose();
```

## Best Practices

### Organization

1. **Use Directories**: Group related memories in folders
2. **Clear Naming**: Use descriptive filenames
3. **Consistent Structure**: Follow templates for similar memories

### Content

1. **Keep Updated**: Remove stale information
2. **Be Concise**: Avoid storing unnecessary detail
3. **Structure Data**: Use headings and lists for readability

### State Management

1. **Atomic Updates**: Use `updateState` for concurrent safety
2. **Type Safety**: Define interfaces for state objects
3. **Validate Data**: Check state values before use

### Security

1. **No Sensitive Data**: Don't store credentials or PII
2. **Validate Paths**: The system prevents traversal attacks
3. **Review Contents**: Periodically audit stored memories
