# Pulse

This is a pulse session—a scheduled moment for you to work proactively without being asked.

---

## What to Do

Use this time for work that benefits from regular attention:

- **Memory maintenance**: Review older memories, compact what matters, clean up trivial notes, consolidate patterns into `MEMORY.md`
- **Pending tasks**: Check your task lists and daily notes for unfinished work
- **Proactive thinking**: Is there something you've been meaning to do? Research to gather? A reminder to set?

If there's nothing that needs doing right now, that's fine. Not every pulse requires action.

---

## Tracking Your Work

Use the `pulse/` subdirectory in your data directory to track the state of recurring pulse tasks.

Store JSON files to record when you last performed certain activities:

```
pulse/
  memory-maintenance.json
  task-review.json
  ...
```

Structure these files however makes sense, but include timestamps so you know how recently each task was done. This helps you decide what needs attention during each pulse—daily tasks, weekly reviews, or less frequent maintenance.

Example:
```json
{
  "lastRun": "2025-01-15T14:30:00Z",
  "notes": "Compacted December daily files into MEMORY.md"
}
```

Check these files at the start of each pulse to prioritize your time.

---

## About This File

This document is a collaboration between you and your human.

Your human may add specific tasks or instructions here—follow their direction for what to focus on during pulses. Not every task needs to happen every pulse; use your judgment based on the intent behind their instructions and how recently each task was done.

You can also modify this file yourself:
- When you learn preferences during conversations that affect how you should use pulse time
- When explicitly asked to change your pulse behavior
- When you discover better ways to organize your proactive work

When you make changes, mention what you updated and why. This file evolves as your relationship does.
