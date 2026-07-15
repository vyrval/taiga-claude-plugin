---
name: taiga
description: Work with Taiga project management - list projects, create and update user stories, tasks and epics, move items across the kanban board, summarize sprint progress. Use when the user mentions Taiga, their kanban board, sprints, user stories, or asks to create/update/triage tasks in their project tracker.
---

# Taiga workflows

Use the `taiga` MCP tools to read and change data in the user's Taiga workspace.

## Ground rules

- Call `get_project` once per project before creating or updating anything. It returns the valid status names, member usernames, and sprint names — pass these verbatim to other tools.
- Refer to items by their `ref` (the `#123` number visible in Taiga) plus the project slug. Internal ids are a fallback.
- Statuses, assignees, and sprints are passed by name; the server resolves them to ids and returns a clear error listing valid values if a name doesn't match.
- `assigned_to: "me"` assigns to the authenticated user; `"none"` unassigns.
- Updates handle Taiga's version-based concurrency automatically — never ask the user about version numbers.
- List tools return 30 items per page; check `total` in the response and fetch more pages when summarizing.

## Common workflows

**Task creation**: If the user names a story ("add a task to #42"), pass `user_story_ref`. Standalone tasks need only project + subject. Batch requests ("create tasks for X, Y, Z") = one `create_task` call per task.

**Board management**: Moving a card = `update_user_story` / `update_task` with the target `status` name. Confirm destructive-feeling bulk moves (more than ~5 items) with the user before executing.

**Standup / sprint summary**: `get_project` for sprint names → `list_user_stories` filtered by `sprint` → group by status and assignee. Include refs in the summary so items are clickable in Taiga.

**Triage**: `list_user_stories` or `list_tasks` with `assigned_to`/`status` filters, then `update_*` and `add_comment` to record decisions.

**Deletion**: `delete_user_story`, `delete_task`, and `delete_epic` permanently remove an item, addressed by project+ref or id. Deletion is irreversible, so always confirm the specific item(s) with the user first and echo back the ref and subject before calling. Deleting an epic unlinks its user stories but does not delete them. For bulk deletes, list what will be removed and get explicit confirmation before executing.

## Limits

- Wiki, issues, and attachments are not covered in this version.
- Item URLs follow `https://tree.taiga.io/project/{slug}/us/{ref}` (stories), `.../task/{ref}` (tasks), `.../epic/{ref}` (epics) on Taiga cloud.
