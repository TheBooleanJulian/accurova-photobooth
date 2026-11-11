# ADR 0001 — Monorepo and toolchain

Date: 2026-11-11 · Status: accepted

## Context
The repository was empty. The prompt prefers React, TypeScript, Vite,
Tailwind, React Router, Zustand, vite-plugin-pwa and FastAPI.

## Decision
- npm workspaces (`apps/*`, `packages/*`); no extra monorepo tool.
- Packages are consumed as TypeScript source (no build step per package).
- One root `tsconfig.json` and one root vitest config.
- Pinned to Vite 7, Vitest 3, TypeScript 5.9, React 19, React Router 7,
  Tailwind 4, zod 4. Newer majors existed on the day; these were chosen as
  known-stable. Upgrade deliberately, not incidentally.
- One app (`apps/kiosk`) serves both kiosk and admin routes for now.
  `apps/admin` is split out only if the admin bundle or its auth needs warrant it.
- Zustand and IndexedDB are not installed yet; they arrive with session state in M2.

## Consequences
Simple install and CI. Admin code ships in the kiosk bundle until split;
admin routes must be protected (M7) before public deployment.
