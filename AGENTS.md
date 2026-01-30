# Project Rules and Guidelines

## Task Management (REQUIRED)

**All work MUST be tracked using the task tool.** This is not optional.

- Create tasks for all non-trivial work before starting implementation
- Break complex work into smaller, trackable tasks
- Mark tasks as `in_progress` when starting work and `completed` when finished
- Never mark a task as complete if:
  - Tests are failing
  - Linting/type errors exist
  - Implementation is incomplete

### Task Dependencies

Always capture dependency relationships between tasks:

- Use `addBlockedBy` to indicate tasks that must complete before the current task can start
- Use `addBlocks` to indicate tasks that are waiting on the current task
- Complete all blocking tasks before starting dependent tasks
- Review the task list regularly to identify newly unblocked tasks

### Parallel Execution with Subagents

**Always use parallel subagents where possible.** When multiple tasks have no dependencies on each other, they MUST be executed concurrently:

- **Identify parallelizable tasks**: Review dependencies - any tasks not blocked by incomplete work can run simultaneously
- **Launch in parallel**: Send a single message with multiple Task tool calls to execute independent tasks concurrently
- **Use appropriate subagent types**: Select the right subagent type for each task (e.g., `Explore` for codebase exploration, `general-purpose` for implementation)
- **Aggregate results**: Once all parallel subagents complete, review results and continue with dependent work

Example workflow:
```
1. Create tasks with proper dependencies (A blocks B, C is independent)
2. Launch subagents for A and C in parallel (single message, multiple Task calls)
3. Wait for both to complete
4. Launch subagent for B (now unblocked)
5. Continue until all tasks complete
```

This significantly speeds up completion of multi-step work.

## Pre-Finish Checklist

Before finishing any task or marking work as complete:

1. **Run checks**: Execute linting, type checking, or static analysis tools
2. **Fix issues**: Address all linting errors, type errors, and warnings
3. **Verify tests**: Ensure all tests pass (if tests exist)
4. **Review changes**: Verify the changes align with the task requirements

## Code Style and Linting

All code must comply with the project's Biome configuration. Before planning or writing code, consult `biome.json` for the current lint and format rules. This ensures planned code aligns with project standards and avoids rework.

Run `pnpm biome check` to verify compliance.