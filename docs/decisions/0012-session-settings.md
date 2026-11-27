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

## Readings in story S7

The user did not decide these points. The builder of story S7 recorded them. The advisor decided each one, except the first, which the coordinator decided.

- The list of models in Aether can lag behind Claude. The agent refuses a model that it does not know, the session shows a start notice, and no prompt goes out. Aether keeps no second list in the main process. Source: the coordinator, 2026-11-27.
- The agent port reports the mode that the agent uses as an update `mode`. `providers/acp` translates `current_mode_update` and drops a mode ID that the port does not know.
- The notice of the Auto fallback has the code `auto-fallback` and the tone info. It shows only when the saved mode is Auto and the agent reports Accept edits. No other change of the mode gives a notice. It shows again at each process start that has this fallback, a resume included.
- A file, folder, repository file or repository folder attachment gives one resource link, with the path as a `file:` URI. A relative path is taken from the session folder.
- An issue or pull request attachment adds its URL to the text for the agent, after the line "References:". The saved message of the user keeps the typed text.
- The links and the URLs go with the turn that creates the first agent run. A first start that failed saved no run, so its retry sends them again. A resume sends no link.
- Each `folder` attachment outside the session folder is an additional directory, at each process start, a resume included. Aether compares and passes the real path: `..`, junctions and letter case are resolved, and a folder that resolves into the session folder needs no entry.
- Each start runs the gate of story S6 for the session folder, then for each additional directory in the order of the attachments. The gate reads the current content of each folder at each start. One question is open at a time. The first refusal ends the start with the refusal notice of S6, and no process starts.
- `sessions.send-message` refuses an attachment of an unknown kind and a session attachment with the error `unsupported-attachment`, before the turn and before any process. The check runs when the message needs a new process. `sessions.create` keeps the kind as text, because the import of an old draft can hold any kind.

## Rejected

- Keep two controls, Mode and Tool permissions. Claude has one permission mode, so two controls could select one effect twice or select a conflict.
- Map Autopilot to `bypassPermissions`. Approve all already does that. The user renamed Autopilot to Auto, to match Claude.
- Build a worktree now. The Git identity for commits and pushes is an open point, and the cleanup rules are not defined.
