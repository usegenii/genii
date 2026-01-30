# Tasks Documentation

Tasks are specific goals or objectives that can be assigned to an agent. They provide focused context for achieving particular outcomes.

## Overview

Tasks are markdown files stored in the `tasks/` directory of the guidance folder. When an agent is spawned with a task ID, the task document is loaded and its content is added to the system prompt.

## File Structure

```
guidance/
└── tasks/
    ├── onboarding.md
    ├── data-analysis.md
    └── code-review.md
```

## Task Format

### Basic Structure

```markdown
---
id: task-id
title: Human-Readable Title
priority: normal
tags: [tag1, tag2]
---

# Task Title

## Objective
[Clear statement of the goal]

## Context
[Background information]

## Requirements
- [ ] Requirement 1
- [ ] Requirement 2

## Steps
1. Step 1
2. Step 2

## Success Criteria
- Criterion 1
- Criterion 2
```

### Frontmatter

Optional YAML frontmatter can include:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (defaults to filename) |
| `title` | string | Human-readable title |
| `priority` | string | Priority level (low, normal, high, critical) |
| `tags` | array | Tags for categorization |
| `requires` | array | Required skills or capabilities |
| `timeout` | number | Maximum duration in milliseconds |

### Content Sections

#### Objective

A clear, concise statement of what needs to be accomplished:

```markdown
## Objective

Analyze the provided dataset and generate a summary report with key insights.
```

#### Context

Background information that helps the agent understand the situation:

```markdown
## Context

The user is a marketing manager who needs to understand customer behavior
patterns from the last quarter. They have limited technical expertise but
need actionable insights.
```

#### Requirements

Specific conditions that must be met:

```markdown
## Requirements

- [ ] Process all CSV files in the data directory
- [ ] Generate visualizations for key metrics
- [ ] Write findings in non-technical language
- [ ] Complete within the user's session
```

#### Steps

Recommended approach to completing the task:

```markdown
## Steps

1. **Data Validation**: Verify data integrity and format
2. **Analysis**: Run statistical analysis on key metrics
3. **Visualization**: Create charts for significant findings
4. **Report**: Write executive summary
```

#### Success Criteria

How to determine if the task is complete:

```markdown
## Success Criteria

The task is complete when:
- All data files have been processed without errors
- At least 3 visualizations have been generated
- The summary report is under 500 words
- The user confirms the report meets their needs
```

## Loading Tasks

Tasks are loaded through the GuidanceContext:

```typescript
// Load a specific task
const task = await guidance.loadTask("data-analysis");

// List all available tasks
const tasks = await guidance.listTasks();
```

## Task ID Resolution

Task IDs are resolved in this order:

1. Exact match with frontmatter `id` field
2. Exact match with filename (without .md extension)
3. Case-insensitive match with filename

## Best Practices

1. **Be Specific**: Clear objectives lead to better results
2. **Provide Context**: Help the agent understand the "why"
3. **Define Success**: Measurable criteria prevent ambiguity
4. **Keep Focused**: One main goal per task
5. **Use Checkboxes**: Visual progress tracking with `- [ ]`
