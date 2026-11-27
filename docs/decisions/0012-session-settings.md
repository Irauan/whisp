# 0012 Session settings

Date: 2026-11-25
Decided by: the user, during the brief of milestone m1-chat. The builder of story S3 wrote this record from the brief. The section "Readings in story S3" lists the points that the user did not decide.
Status: accepted

## Context

The composer had two controls that set the permissions of a session: Mode (Interactive, Plan, Autopilot) and Tool permissions (Always ask, Assisted, Approve all). Claude has one permission mode. Two controls could select one effect twice, or select a conflict. The old composer also copied "Approve all" from the last session into a new one (decision 0007 forbids it).

The words follow decision 0013: a profile owns its sessions.

## Decision

1. One Mode control replaces the controls Mode and Tool permissions. It has five values, in this order:

   | Port value | Label |
   |---|---|
   | `ask` | Ask |
   | `accept-edits` | Accept edits |
   | `plan` | Plan |
   | `auto` | Auto |
   | `approve-all` | Approve all |

2. The agent port uses the neutral values of the first column. The database stores them (migration `001`). A provider translates them. The provider `claude-code` maps them to the permission modes of Claude:

   | Port value | Claude permission mode |
   |---|---|
   | `ask` | `default` |
   | `accept-edits` | `acceptEdits` |
   | `plan` | `plan` |
   | `auto` | `auto` |
   | `approve-all` | `bypassPermissions` |

   If the model cannot use `auto`, Claude uses `acceptEdits`, and Aether shows a notice.

3. A new session copies the mode of the newest created session of the current profile. Approve all is never copied: a new session then starts with Ask.

4. The import of an old draft maps its old settings in this order. The first line that matches wins:

   | Old settings | Mode |
   |---|---|
   | Mode Plan | `plan` |
   | Mode Autopilot | `auto` |
   | Tool permissions Approve all | `approve-all` |
   | Tool permissions Assisted | `auto` |
   | Anything else | `ask` |

   The import never gives `accept-edits`, because the old settings had no such value.

5. The settings of a session map to the agent as below.

   | Aether setting | Agent input |
   |---|---|
   | Model | The `model` configuration option. "Default" sends nothing. |
   | Mode Ask | Permission mode `default`. Claude asks before each tool. |
   | Mode Accept edits | Permission mode `acceptEdits` |
   | Mode Plan | Permission mode `plan` |
   | Mode Auto | Permission mode `auto`. If the model cannot use it, Claude uses `acceptEdits` and Aether shows the notice. |
   | Mode Approve all | Permission mode `bypassPermissions` |
   | Worktree | Disabled, "coming soon". The session uses the folder as it is. |
   | Attachment: file, folder, repository file or folder | A resource link in the first message |
   | Attachment: folder outside the session folder | Also an additional directory, after the directory question |
   | Attachment: issue or pull request | The URL as text in the first message |
   | Attachment: session | Disabled, "coming soon" |

6. Aether sets the permission mode before the first message. If the agent cannot apply the mode or the model, the session does not start (decision 0007).

## Readings in story S3

The user did not decide these points. The builder of story S3 recorded them, with their source.

- "Newest" means the latest creation time. Source: the test author and the coordinator.
- Two sessions with one creation time keep the order of insertion. A profile without sessions starts with Ask. Source: the advisor.
- A session that the user creates with Approve all keeps Approve all. Only the next new session shows Ask. Source: the locked test of check A14.
- The rule of item 3 is a pure function of the domain of the feature `sessions`. Source: the coordinator.
- The "last session" of the brief, in check A14, is the newest created session of the current profile. Source: the coordinator.
- The "settings menu" of check A13 is the set of the composer controls of a new session. Source: the coordinator.
- The `&` suggestion counts as the session attachment of check A13. Source: the coordinator.

## Rejected

- Keep two controls, Mode and Tool permissions. Claude has one permission mode, so two controls could select one effect twice or select a conflict.
- Map Autopilot to `bypassPermissions`. Approve all already does that. The user renamed Autopilot to Auto, to match Claude.
- Build a worktree now. The Git identity for commits and pushes is an open point, and the cleanup rules are not defined.
