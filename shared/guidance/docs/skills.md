# Skills Documentation

Skills are reusable capabilities that can be loaded by an agent to extend its abilities for specific domains or tasks.

## Overview

Skills are directories within the `skills/` folder, each containing a README.md and optional artifact files. When a skill is loaded, its documentation is made available to the agent.

## Directory Structure

```
guidance/
└── skills/
    ├── data-analysis/
    │   ├── README.md
    │   ├── templates/
    │   │   └── report-template.md
    │   └── examples/
    │       └── sample-analysis.md
    ├── code-review/
    │   └── README.md
    └── customer-support/
        ├── README.md
        └── scripts/
            └── escalation-guide.md
```

## Skill Format

### README.md (Required)

Every skill must have a README.md that describes the capability:

```markdown
# Skill Name

Brief description of what this skill enables.

## Overview
[Detailed description]

## Capabilities
- Capability 1
- Capability 2

## Usage
[How to use this skill]

## Examples
[Example interactions]

## Best Practices
[Guidelines for effective use]

## Limitations
[What this skill cannot do]
```

### Artifacts (Optional)

Additional files that support the skill:

- **Templates**: Reusable document structures
- **Examples**: Sample inputs and outputs
- **Scripts**: Step-by-step procedures
- **Data**: Reference information

## Loading Skills

Skills are loaded through the GuidanceContext:

```typescript
// Load a specific skill
const skill = await guidance.loadSkill("data-analysis");

if (skill) {
  console.log(skill.readme);          // README content
  console.log(skill.artifacts);        // Map of filename -> content
}

// List all available skills
const skills = await guidance.listSkills();
```

## Skill Bundle Structure

When a skill is loaded, it returns a `SkillBundle`:

```typescript
interface SkillBundle {
  path: string;                    // Path to skill directory
  readme: string;                  // README.md content
  artifacts: Map<string, string>;  // Additional files
}
```

## Nested Skills

Skills can be organized hierarchically:

```
skills/
├── communication/
│   ├── README.md
│   ├── email/
│   │   └── README.md
│   └── chat/
│       └── README.md
└── analysis/
    └── README.md
```

Access nested skills with path notation: `communication/email`

## Best Practices

### Skill Design

1. **Single Responsibility**: Each skill should do one thing well
2. **Self-Contained**: Include all necessary context in the README
3. **Clear Examples**: Show concrete usage examples
4. **Document Limitations**: Be explicit about what the skill cannot do

### Artifact Organization

1. **Consistent Naming**: Use clear, descriptive filenames
2. **Logical Grouping**: Group related artifacts in subdirectories
3. **Format Appropriately**: Use markdown for text, JSON for data

### README Structure

1. **Start with Overview**: Quick understanding of the skill
2. **List Capabilities**: What the agent can do with this skill
3. **Provide Examples**: Concrete usage scenarios
4. **Note Limitations**: Prevent misuse

## Example: Data Analysis Skill

```markdown
# Data Analysis

Analyze datasets and generate insights with statistical rigor.

## Capabilities

- Statistical analysis (mean, median, std dev, correlation)
- Data visualization recommendations
- Outlier detection
- Trend identification

## Usage

When analyzing data:
1. First validate data quality
2. Identify appropriate statistical methods
3. Generate insights with confidence intervals
4. Recommend visualizations

## Examples

### Analyzing Sales Data

User: "Analyze sales.csv and tell me what's happening"

Approach:
1. Load and validate the data
2. Calculate summary statistics
3. Identify trends over time
4. Check for seasonal patterns
5. Report findings with confidence levels

## Best Practices

- Always check data quality first
- Report confidence intervals, not just point estimates
- Use appropriate visualizations for the data type
- Explain findings in accessible language

## Limitations

- Cannot perform causal inference without experimental design
- Limited to datasets that fit in memory
- Statistical methods assume certain data properties
```
