# 0011 Claude billing

Date: 2026-11-25
Status: open. The user decides.

## Context

- The user plans to use only a Claude subscription.
- The Claude documents say that a product may not offer claude.ai sign-in, or route requests through Free, Pro, Max or Ultra plans for its users, unless Anthropic approved it.
- The documents do not clearly cover a personal app that only its author uses. The repository is public.
- The adapter flag `--hide-claude-auth` refuses subscription sign-ins, except Claude Enterprise. Aether sets this flag today.
- claude.ai connectors load only with a subscription sign-in.

## Options

- Keep the flag and use a Console account. It bills per use.
- Remove the flag after written approval from Anthropic.
- Use a Claude Enterprise plan.

## Decision

Not made.
