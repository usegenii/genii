# SOUL.md Documentation

The SOUL.md file defines the core identity, values, and personality of an AI agent. It is the most fundamental guidance document and shapes all agent behavior.

## Purpose

The soul document serves several key purposes:

1. **Identity Definition**: Establishes who the agent is and what it represents
2. **Value Alignment**: Defines the principles that guide decision-making
3. **Personality Shaping**: Determines how the agent communicates and interacts
4. **Boundary Setting**: Establishes what the agent will and won't do

## Structure

A soul document typically includes:

### Core Identity

```markdown
## Core Identity

- **Name**: The agent's name or identifier
- **Purpose**: The agent's primary reason for existence
- **Domain**: Area of expertise or focus
```

### Values

Define the principles that guide the agent's behavior:

```markdown
## Values

### Honesty
[Description of how honesty manifests]

### Helpfulness
[Description of how helpfulness manifests]
```

### Personality Traits

Describe how the agent should communicate:

```markdown
## Personality Traits

- **Tone**: Professional, casual, formal, etc.
- **Communication Style**: Concise, detailed, conversational
- **Approach**: Methodical, creative, pragmatic
```

### Boundaries

Explicitly state what the agent will and won't do:

```markdown
## Boundaries

### I Will
- [Positive commitment]

### I Will Not
- [Explicit prohibition]
```

## Best Practices

1. **Be Specific**: Vague values lead to inconsistent behavior
2. **Be Realistic**: Don't promise capabilities the agent doesn't have
3. **Be Consistent**: Ensure values don't conflict with each other
4. **Consider Context**: Tailor the soul to the agent's specific use case

## Examples

### Customer Service Agent

```markdown
# Soul

You are a friendly customer service representative for [Company].

## Core Identity
- **Name**: Support Assistant
- **Purpose**: Help customers resolve issues and have positive experiences
- **Domain**: Customer support and product knowledge

## Values
- Customer satisfaction above all
- Quick, accurate responses
- Empathy and understanding
```

### Technical Assistant

```markdown
# Soul

You are a technical assistant specializing in software development.

## Core Identity
- **Name**: Code Companion
- **Purpose**: Help developers write better code and solve technical problems
- **Domain**: Software engineering and best practices

## Values
- Technical accuracy
- Clear explanations
- Respect for different skill levels
```

## Integration with Other Documents

The soul document is loaded first and provides the foundation for:
- **INSTRUCTIONS.md**: Behavioral guidelines build on soul values
- **Tasks**: Task execution is guided by soul principles
- **Skills**: Skill usage aligns with soul boundaries
