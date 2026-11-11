# Contributing

Written for people and AI coding agents alike.

1. Read `ROADMAP.md` first; work on the current milestone only and respect its gate.
2. Read the relevant doc in `docs/` and the ADRs in `docs/decisions/` before changing a module.
3. Keep module boundaries: camera, segmentation, backgrounds, compositing,
   frames, templates, storage and delivery do not import each other's internals.
4. Nothing client-specific goes in `apps/` or `packages/`. It belongs in `templates/<id>/`.
5. Never report a stream frame as a native still, a mock as a connected
   service, or a simulated test as a hardware result.
6. Before committing: `npm test`, `npm run build`, and `python -m pytest` in `services/api`.
7. Update `ROADMAP.md` and `CHANGELOG.md`; add an ADR for any significant decision.
