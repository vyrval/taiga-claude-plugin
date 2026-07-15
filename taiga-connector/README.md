# Taiga connector

Connects Claude to [Taiga](https://taiga.io) (cloud or self-hosted) for browsing projects and creating and managing user stories, tasks, and epics.

## Requirements

- Node.js 18 or newer on your machine (`node --version` to check)
- A Taiga account

## Setup

Create a file called `.taiga-mcp.json` in your home folder:

```json
{
  "username": "your-taiga-username",
  "password": "your-taiga-password"
}
```

For self-hosted Taiga, add `"baseUrl": "https://taiga.yourcompany.com"`.

Alternatively, set the environment variables `TAIGA_USERNAME` and `TAIGA_PASSWORD` (and `TAIGA_API_URL` for self-hosted) where the Claude app can see them.

Then install the plugin and ask Claude something like "list my Taiga projects".

## What Claude can do

| Area | Tools |
|------|-------|
| Projects | `list_projects`, `get_project` (members, sprints, valid statuses) |
| User stories | `list_user_stories`, `get_user_story`, `create_user_story`, `update_user_story` |
| Tasks | `list_tasks`, `get_task`, `create_task`, `update_task` |
| Epics | `list_epics`, `get_epic`, `create_epic`, `update_epic` |
| Comments | `add_comment` on stories, tasks, and epics |
| Deletion | `delete_user_story`, `delete_task`, `delete_epic` |

Notable conveniences: items are addressed by their `#ref` numbers, statuses/assignees/sprints are passed by name, `assigned_to: "me"` works, and stories can be linked to an epic at creation time.

**Deletion is permanent.** The delete tools call Taiga's REST `DELETE` endpoints and cannot be undone; Claude will confirm the specific item before removing it. Deleting an epic unlinks its user stories but does not delete them.

## Not covered (yet)

Issues, wiki pages, attachments, custom attributes, and project administration.
