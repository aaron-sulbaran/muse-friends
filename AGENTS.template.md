# <!-- Project Name -->

<!-- One paragraph: what the project is, who it's for, what makes it distinctive. -->

## Live URLs

- Production: <!-- URL -->
- Preview: <!-- URL -->
- Hosting project ID: <!-- ID -->
- Owner: <!-- name -->
- Deadline: <!-- date -->

## Source-of-truth docs

- <!-- doc path: what it is authoritative for -->

## Authority order

AGENTS.md is authoritative for repo-wide conventions and stable architecture. Sibling appendix docs are authoritative for current-increment scope only. Where they overlap, AGENTS.md wins.

## Living document protocol

This document is a living artifact. Agents working in this context follow these rules:

**Two layers, two update rules.**

Layer 1 is manually curated and closely maintained with a human-in-the-loop. However, at the start of a project from scratch or at initial creation of an AGENTS.md file in an existing codebase, an AI recommendation of what to include is acceptable. Stable conventions, scope guardrails, communication preferences, MCP rules. Agents read but do not edit. Layer 1 changes only by direct user instruction.

Layer 2 is agent-maintained. Build state, architecture diagrams, environment, in-flight work, known issues, what's next. Agents update via surgical edits at session end.

**Session-end requirement.**

Before declaring a session complete that shipped meaningful work, the agent must:

1. Re-read this document end to end.
2. Check observed reality against documented state. Files added, dependencies installed, environment variables introduced, behaviors changed.
3. Propose surgical edits to Layer 2 sections only. Use the existing format and emoji conventions.
4. Update the date stamp on the "Current build state" header to today's date if that section was modified.
5. Show the user the diff as a unified diff in a fenced ```diff block.
6. Apply only after explicit user confirmation.

A session that did research, planning, or no shipped work does not update build state.

**Drift detection is eager, not lazy.**

If at any point during the session the agent observes that documented state contradicts code reality (a feature flagged "shipped" appears broken, a documented file does not exist, a "no rate limiting" note exists alongside Upstash imports), surface this to the user immediately. Do not silently work around documented state.

**Length budget.**

This document stays under 40,000 characters. The Claude Code CLI warns when a single AGENTS.md / CLAUDE.md exceeds ~40 KB, and oversized files degrade context quality across every session in the project. Before any edit that grows the file, check current size with `wc -c AGENTS.md` (or `CLAUDE.md`).

When an edit would push the file over 40,000 characters, or the file is already over, **never delete content outright**. Archive first, then trim:

1. Identify the oldest Layer 2 entries to retire: resolved ✅ build-state items past their useful window, superseded "What's next" rankings, stale architecture notes for code paths that have since been refactored.
2. Append them, verbatim, to a sibling `AGENTS_ARCHIVE.md` (or `CLAUDE_ARCHIVE.md` if archiving from CLAUDE.md) under a dated header like `## Archived YYYY-MM-DD`. The archive grows chronologically so previous build snapshots remain readable as a history of what shipped.
3. Create the archive file if it does not yet exist. It is also a private working document and belongs in `.gitignore` alongside AGENTS.md / CLAUDE.md.
4. Only after the archive write is staged, remove the moved entries from the live file.
5. Show the user both diffs (live file and archive) before applying.

Layer 1 content is never archived. Layer 1 changes only by direct user instruction.

**Date stamps.**

Only the "Current build state" header carries a (YYYY-MM-DD) stamp. Other Layer 2 sections (Architecture, Environment, What's next) are not stamped. The source of "today's date" is the date in the agent's environment context block. Update the stamp to today when modifying the "Current build state" section.

**Format conventions.**

Match existing emoji and bullet style exactly. ✅ for shipped. 🔄 for in flight. ⚠️ for known issues or not yet done. New emoji conventions require Layer 1 edits, which agents do not make.

**Authority order.**

Project AGENTS.md / CLAUDE.md is authoritative for repo-wide conventions and stable architecture. Sibling appendix docs (e.g. NEXT_STEPS.md, current-increment specs) are authoritative for current scope only. Where they overlap on conventions, the AGENTS.md / CLAUDE.md wins.

# Layer 1: Stable Conventions (Manually Curated)

Read-only for agents. Edits to this layer require direct user instruction.

## Stack

| Layer | Choice |
|---|---|
| Framework | <!-- --> |
| Language | <!-- --> |
| UI | <!-- --> |
| AI | <!-- SDK + provider + model strings --> |
| Storage | <!-- --> |
| Hosting | <!-- --> |
| Package manager | <!-- --> |

## Locked conventions

### Public-repo hygiene
<!-- What may and may not be committed. -->

### Code conventions
<!-- Style rules, type strictness, validation library. -->

### Scope guardrails
<!-- What NOT to build without explicit confirmation. -->

## MCP tooling rules

<!-- Which MCP servers to prefer for which tasks. -->

## Subagent / parallel work

<!-- When to delegate, which subagent type for what. -->

## Communication preferences

<!-- Tone, plan-first vs action-first, follow-up cadence. -->

## Common tasks

| Task | Command |
|---|---|
| Local dev | <!-- --> |
| Build | <!-- --> |
| Deploy | <!-- --> |

# Layer 2: Build State (Agent-Maintained)

Agents update this layer at session end via the protocol above. Match existing format and emoji conventions exactly.

## Architecture

<!-- File tree of relevant directories. Mark planned files with (planned). -->

## Current build state (YYYY-MM-DD)

Shipped and working:

- <!-- ✅ -->

In flight:

- <!-- 🔄 -->

Known issues / not yet done:

- <!-- ⚠️ -->

## Environment

<!-- Env var checklist with set/unset markers. -->

## What's next, ranked

1. <!-- -->
