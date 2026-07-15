# Notes For Coding Agents

This repo includes lightweight YAIML-style project memory. It is a loose usage convention, not a hard repository contract or release requirement.

For larger changes, audits, release work, or moments where project direction matters, it is useful to read:

1. Read `yaiml.yml`.
2. Read the stable header at the top of each declared YAIML document.
3. Treat `STATE_OF_THE_UNION.md` as the SOT role: current engineering state, direction, risks, divergence, and recent lessons.
4. Treat `ARCHITECTURE.md` as durable system shape and design intent.
5. Treat `MAINTAINER_GUIDE.md` as setup, commands, diagnostics, release, and recovery procedure.
6. Use `docs/YAIML.md` for this repo's local project-memory convention.

Working rules:

- Preserve the difference between human intent, verified code behavior, and agent inference.
- When a change materially affects product direction, architecture, commands, release flow, or known risks, update the relevant memory document if doing so will help the next session.
- Treat phrases such as "update YAIML", "updated YAIML", "check new YAIML", or "run a YAIML update" as convention-refresh requests: compare this repo's YAIML scaffolding against a human-provided, workspace-provided, or team-approved YAIML reference, refresh compatible prompts/templates/guidance/pointers, and preserve project-specific memory.
- Prune stale statements instead of appending contradictory new ones.
- Keep source-only experiments, release manifests, and marketplace behavior clearly separated.
- Do not broaden extension permissions or runtime surface without an explicit product/review reason.
- Do not store transcript text, playback state, or diagnostic data outside the intended local extension storage model.
- Do not revert unrelated working-tree changes.

Current high-signal checks:

```powershell
npm test
npm run release:sanity
```

Use narrower tests when appropriate, but report when the full suite was not run.
