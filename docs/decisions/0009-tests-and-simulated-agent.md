# 0009 Test layers and the simulated agent

Date: 2026-11-25
Decided by: the user, on a proposal of the architecture session (step 0).
Status: accepted

## Context

`docs/process.md` requires an automated test of the real app with a simulated agent. Live Claude stays out of CI.

## Decision

- Layers: unit, slice, contract, architecture and acceptance. A validator runs live tests per milestone.
- Slice tests use a real SQLite database and the simulated agent over real ACP.
- Acceptance tests run the built app with Playwright.
- The simulated agent is a separate ACP program with scripts and test-controlled gates, without timers.
- Tests register it in `agents.json` of a temporary data folder. The product has no test hook.

## Trade-offs

- Playwright support for Electron is experimental. It ran the current app with Electron 45.
