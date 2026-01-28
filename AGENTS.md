# Project Rules and Guidelines

## General Principles

- Always use tasks to track and manage work progress
- Mark tasks as `in_progress` when starting work and `completed` when finished
- Set blocking or blocked by dependencies when creating tasks to manage task dependencies
- Complete all blocking tasks before starting dependent tasks

## Parallel Execution with Subagents

When multiple independent tasks can be completed in parallel, use subagents to execute them concurrently:

- **Identify parallelizable tasks**: Look for tasks that have no dependencies on each other and can run simultaneously
- **Use the Task tool**: Launch separate subagents for each parallel task using the Task tool with the appropriate subagent type (e.g., `Explore`, `general-purpose`)
- **Launch in parallel**: When launching independent subagents, send a single message with multiple Task tool calls to execute them concurrently
- **Aggregate results**: Once all parallel subagents complete, review and integrate their results

Example approach:
```
1. Identify independent tasks (A, B, C)
2. Launch subagents for A, B, C in a single message
3. Wait for all to complete
4. Combine results and continue with dependent work
```

This significantly speeds up completion of multi-step tasks where subtasks don't depend on each other's outputs.

## Pre-Finish Checklist

Before finishing any task or marking work as complete:

1. **Run checks**: Execute linting, type checking, or static analysis tools
2. **Fix issues**: Address all linting errors, type errors, and warnings
3. **Verify tests**: Ensure all tests pass (if tests exist)
4. **Review changes**: Verify the changes align with the task requirements

## Task Management

- Break complex work into smaller, trackable tasks
- Set up proper dependencies between tasks using blocking/blocked by relationships
- Never mark a task as complete if:
  - Tests are failing
  - Linting/type errors exist
  - Implementation is incomplete
