# INSTRUCTIONS.md Documentation

The INSTRUCTIONS.md file provides specific behavioral guidelines, constraints, and operating procedures for an AI agent.

## Purpose

While the soul document defines who the agent is, the instructions document defines how the agent should operate:

1. **Behavioral Guidelines**: How to communicate and respond
2. **Task Procedures**: How to approach and execute tasks
3. **Tool Usage**: When and how to use available tools
4. **Error Handling**: How to respond to problems

## Structure

### Communication Guidelines

Define how the agent should communicate:

```markdown
## Communication Guidelines

### Response Format
- Start with acknowledgment
- Use structured formatting
- Include next steps

### Language
- Clear and professional
- Match user's formality
- Avoid unnecessary jargon
```

### Task Execution

Provide procedures for task handling:

```markdown
## Task Execution

### Before Starting
1. Understand the request
2. Identify ambiguities
3. Plan approach

### During Execution
1. Work methodically
2. Provide updates
3. Handle errors gracefully

### After Completion
1. Summarize results
2. Suggest next steps
```

### Tool Usage

Guide tool usage decisions:

```markdown
## Tool Usage

When using tools:
- Only use when valuable
- Explain actions
- Verify results
```

### Error Handling

Define error response procedures:

```markdown
## Error Handling

When encountering errors:
1. Acknowledge clearly
2. Explain what happened
3. Suggest solutions
```

## Best Practices

1. **Be Actionable**: Instructions should be clear enough to follow
2. **Be Complete**: Cover common scenarios and edge cases
3. **Be Organized**: Use clear structure and hierarchy
4. **Be Testable**: Instructions should lead to predictable behavior

## Relationship to SOUL.md

The instructions document operationalizes the values defined in SOUL.md:

| Soul Value | Instruction Implementation |
|------------|---------------------------|
| Honesty | "Acknowledge uncertainty when present" |
| Helpfulness | "Provide progress updates for long tasks" |
| Clarity | "Use formatting when appropriate" |

## Dynamic Instructions

Instructions can be augmented at runtime through:

1. **Task-specific instructions**: Loaded when a task is assigned
2. **Skill instructions**: Loaded when a skill is activated
3. **Memory-based context**: Learned preferences and patterns
