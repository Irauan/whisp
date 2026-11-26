# Aether

Aether is a desktop workspace for agent sessions. It uses Electron, React and TypeScript.

## Rules for every session

- Read [docs/process.md](docs/process.md) first. It binds every session.
- Read [docs/architecture.md](docs/architecture.md) before you change code.
- Read [docs/decisions/](docs/decisions/) before you touch an approved decision. Never change one alone.
- Read [docs/models.md](docs/models.md) to choose a model and an effort.
- Read [docs/milestones/](docs/milestones/) for the brief and the plan of the current milestone.
- State lives in files. Do not rely on the conversation of another session.

## Environment

- Windows 11. Node 24.15 or later.
- Run `npm run typecheck` before each commit.
- Run `npm run lint` before each commit.
- Run `npm run architecture` before each commit.
- Run `npm test` before each commit.

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

## Writing

- Write in the active voice. Use the imperative for instructions.
- Keep one topic in each sentence.
- Keep each instruction to 20 words or fewer. Keep each description to 25 words or fewer.
- Keep each paragraph to 6 sentences or fewer.
