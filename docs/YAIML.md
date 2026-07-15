---
yaiml: 0.2
role: ai-coding-memory
title: YAIML Usage For YTMMOCC
purpose: Local loose-use guide for YAIML-style project-memory documents and AI-coding continuity.
belongs-here: document roles, stable-header expectations, evidence rules, pruning rules, update workflow, agent handoff behavior.
not-here: complete project status, durable extension architecture, command reference.
durability: durable guidance; update when this repo changes how it uses YAIML.
read-with: State of the Union; YTMMOCC Architecture Notes; YTMMOCC Maintainer Guide.
update-when: YAIML roles, document ownership, evidence rules, or agent-maintenance workflow change.
agent-guidance: Treat this as a repo-local memory convention, not a substitute for inspecting code and tests.
---

# YAIML Usage For YTMMOCC

YAIML preserves the current interpreted understanding of a software project across disposable coding-agent sessions.

Coding agents are temporary. The project's engineering understanding should remain in the repository.

This repository uses YAIML loosely. These documents are human-readable project memory, not a schema, validator, compliance layer, build input, or release gate.

## This Repo's YAIML Family

`yaiml.yml` is a lightweight map of the current document family:

- `STATE_OF_THE_UNION.md`: SOT role. Current engineering state, direction, active risks, divergence, useful lessons, and near-term priorities.
- `ARCHITECTURE.md`: Architecture role. Durable system shape, ownership boundaries, data flow, invariants, intended design, and retired approaches.
- `MAINTAINER_GUIDE.md`: Maintainer role. Setup, commands, tests, packaging, release flow, diagnostics, and recovery procedures.
- Supporting documents: risk review, release procedure, QA checklist, release-version checklist, privacy policy, source submission notes, and this YAIML guide.

The filenames are repo-specific. The roles are the important part.

## Stable Headers

YAIML-style documents may begin with a short stable header that orients a future coding agent. In this repo, the headers are guidance for readers, not fields that tooling depends on.

A healthy header answers:

- what the document is;
- what responsibility it owns;
- what belongs there;
- what does not belong there;
- how durable or volatile it is;
- which related documents to read;
- when it should be updated;
- how to handle evidence, uncertainty, conflicts, pruning, and human direction.

The header is an operating guide, not a rigid schema.

## Evidence Rules

Do not silently blend different kinds of truth:

- Human direction is authoritative for intended product meaning.
- Code, tests, commands, artifacts, and runtime behavior are authoritative for what currently exists.
- Agent inference can be useful, but mark it as inference when it matters.
- Open questions and contradictions should stay visible until resolved.

When implementation and intent disagree, record the disagreement. Do not rewrite intent to match broken code, and do not describe intended behavior as implemented behavior.

## Where Facts Belong

- Current engineering situation belongs in `STATE_OF_THE_UNION.md`.
- Durable system shape belongs in `ARCHITECTURE.md`.
- How to operate, test, debug, release, or recover belongs in `MAINTAINER_GUIDE.md`.
- Marketplace, privacy, source submission, QA, and risk topics belong in their focused supporting documents.

If one document starts absorbing another role's job, split or prune rather than normalizing the blur.

## Update Workflow

After meaningful work, update project memory when it will help the next session:

1. Inspect the changed files and test results.
2. Decide whether current state, architecture, maintainer procedures, or a supporting document changed.
3. Update only the affected YAIML documents.
4. Remove stale claims that are no longer true.
5. Preserve human directives and product decisions.
6. Mark unverified claims as unverified.

Do not append a session transcript or chronological work log. Keep useful engineering meaning and discard sediment.

## Convention Refresh Workflow

In this repo, "update YAIML", "updated YAIML", "check new YAIML", or "run a YAIML update" means to refresh YAIML convention scaffolding from a human-provided, workspace-provided, or team-approved reference, not to rewrite this extension's project memory.

Reference hint:

- Provide a local or team-approved YAIML reference at run time. Do not commit machine-specific paths, local drive names, user profile paths, `file://` URIs, localhost URLs, or private workspace URLs into versioned project memory.

For a convention refresh:

1. Read this repo's agent instructions, `yaiml.yml`, and the stable headers for the core YAIML documents.
2. Check git status and treat existing uncommitted changes as intentional WIP.
3. Inspect the YAIML reference repository provided by the human, workspace, or team-approved process.
4. Compare reference prompts, templates, README guidance, agent-integration guidance, Maintainer Guide wording, and discovery hints.
5. Apply only compatible updates to local YAIML scaffolding: prompt/template copies if they exist, `yaiml.yml` hints, agent-instruction pointers, this guide, and YAIML-maintenance notes.
6. Preserve project-specific SoT current state, Architecture facts, Maintainer commands, risks, human decisions, local naming choices, and supporting documents that contain real project knowledge.

Do not add YAIML as a package dependency, runtime, CLI, schema validator, hosted service, build step, or formal compliance layer.

## Pruning Rules

The goal is useful continuity, not maximum memory.

- SOT should synthesize and prune aggressively.
- Architecture should keep durable decisions and current shape.
- Maintainer Guide should delete obsolete commands and procedures quickly.
- Risk, release, QA, privacy, and source-submission docs should retain the detail their domain needs, but still remove stale instructions.

## Cold-Start Agent Routine

For a substantial new coding session:

1. Read `yaiml.yml`.
2. Read the stable headers for declared documents.
3. Read `STATE_OF_THE_UNION.md`, `ARCHITECTURE.md`, and `MAINTAINER_GUIDE.md`.
4. Read supporting docs relevant to the task.
5. Inspect source code and tests before changing behavior.
6. Implement or review.
7. Run focused checks or explain why they were not run.
8. Update affected YAIML docs after material changes.

## Rejected Uses

YAIML is not:

- a replacement for code, tests, Git history, or issues;
- a generic knowledge base;
- a complete backlog;
- a formal parser or conformance system;
- an excuse to preserve every conversation detail.

Use it as practical engineering memory for future humans and agents.
