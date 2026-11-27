# 0011 Claude billing

Date: 2026-11-25
Decided by: the user on 2026-11-27.
Status: accepted

## Context

- The user plans to use only a Claude subscription.
- The Claude documents say that a product may not offer claude.ai sign-in, or route requests through Free, Pro, Max or Ultra plans for its users, unless Anthropic approved it.
- The documents do not clearly cover a personal app that only its author uses. The repository is public.
- The adapter flag `--hide-claude-auth` refuses subscription sign-ins, except Claude Enterprise. Aether set this flag until 2026-11-27.
- claude.ai connectors load only with a subscription sign-in.

## Decision

Subscription only, for personal use.

- Aether never passes `--hide-claude-auth`. The launch recipe of Claude Code has no such argument.
- A Claude account is signed in with the Claude subscription. The sign-in steps of the notice "Claude Code is not signed in." name that sign-in.
- The risk of the terms of Anthropic is the risk of the user to judge.
- The repository may become private.

## Rejected

- Keep the flag and use a Console account. It bills per use.
- Remove the flag after written approval from Anthropic. The user chose to judge the risk.
- Use a Claude Enterprise plan. The user chose the subscription.
