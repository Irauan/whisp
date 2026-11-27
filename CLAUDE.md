# Aether

Aether is a desktop workspace for agent sessions. It uses Electron, React and TypeScript.

## Rules for every session

- Read [docs/process.md](docs/process.md) first. It binds every session.
- Read [docs/architecture.md](docs/architecture.md) before you change code.
- Read [docs/decisions/](docs/decisions/) before you touch an approved decision. Never change one alone.
- Read [docs/models.md](docs/models.md) to choose a model and an effort.
- Read [docs/milestones/](docs/milestones/) for the brief, the plan and the story specs of the current milestone.
- Read [docs/user-preferences.md](docs/user-preferences.md) before you decide or escalate a question.
- State lives in files. Do not rely on the conversation of another session.

## Environment

- Windows 11. Node 24.15 or later.
- Run `npm run typecheck` before each commit.
- Run `npm run lint` before each commit.
- Run `npm run architecture` before each commit.
- Run `npm test` before each commit.
- Run `npm run lock -- --base origin/milestone/<id>` before you push a story branch.
- Never write into the real Aether data folder (`%APPDATA%\aether`). Use a fake profile for probes.

## Git

- 1Password signs each commit. 1Password asks the user to approve each signature and each SSH connection.
- Wait for the approval. When nobody approves a prompt, the story waits. Independent stories continue.
- Never bypass signing. Never use `--no-gpg-sign`. Never change git config.
- Use auto mode. Never use bypass mode.
- Story PRs squash to `milestone/*`.
- Only the user merges to `main`.
- Never merge a PR unless your role says so.

## Public repository

- The repository is public. Never write a token, a key or real account data in a file.
- Use fake data in tests and examples.
