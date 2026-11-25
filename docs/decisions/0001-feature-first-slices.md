# 0001 Feature-first vertical slices

Date: 2026-11-25
Decided by: the user, on a proposal of the architecture session (step 0).
Status: accepted

## Context

A story in Aether touches the main process, the preload and the renderer. The template organizes code by behavior, with one use case per slice.

## Decision

- Organize code as `features/<aggregate>/<action>/`. One slice is one folder.
- A file suffix names the zone: `.contract.ts`, `.controller.ts`, `.handler.ts`, `.store.ts`, `.ui.tsx`.
- Remove the bounded context level of the template. Aether has one context now.
- Tools, not folders, guard the process boundary.

## Rejected

- Process-first folders (`src/main/features`, `src/renderer/features`). Each story would touch three trees.
- The bounded context level. Each context would hold about one aggregate. A later move is mechanical.
