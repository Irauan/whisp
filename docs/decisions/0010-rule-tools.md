# 0010 Tools for architecture rules

Date: 2026-11-25
Decided by: the user, on a proposal of the architecture session (step 0).
Status: accepted

## Context

TypeScript 7 has no JavaScript compiler API in its npm package. Several tools need that API.

## Decision

- dependency-cruiser with the swc parser checks imports, slices, zones and cycles.
- One tsconfig per zone keeps Node types out of the renderer.
- oxlint with tsgolint checks promises, restricted imports and restricted globals.
- vitest checks the slice shape, the contract registry and the migrations.

## Rejected

- typescript-eslint. It supports TypeScript below 6.1 only.
- ArchUnitTS. It missed a dynamic import in a test.
- dependency-cruiser with its TypeScript parser. It refuses TypeScript 7.0.
