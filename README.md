# Taiga marketplace

A [Claude Code](https://code.claude.com) / Cowork plugin marketplace that distributes the
**taiga-connector** plugin — connecting Claude to [Taiga](https://tree.taiga.io/)
so you can browse projects and create, update, and delete user stories, tasks, and epics
in natural language.

## Install

1. Add the marketplace (once):

   ```
   /plugin marketplace add vyrval/taiga-claude-plugin
   ```

   For other git hosts, use the full clone URL instead:
   `/plugin marketplace add https://github.com/vyrval/taiga-claude-plugin`.

2. Install the plugin:

   ```
   /plugin install taiga-connector@taiga-marketplace
   ```

3. Provide your Taiga credentials. Create `~/.taiga-mcp.json`:

   ```json
   { "username": "your-taiga-username", "password": "your-taiga-password" }
   ```

   - Defaults to Taiga cloud at <https://tree.taiga.io/>.
   - For self-hosted Taiga, add `"baseUrl": "https://taiga.yourcompany.com"`.
   - Alternatively set the `TAIGA_USERNAME`, `TAIGA_PASSWORD`, and `TAIGA_API_URL`
     environment variables.

   Credentials are never stored in this repository — each user supplies their own.

## What the plugin can do

| Area | Tools |
|------|-------|
| Projects | `list_projects`, `get_project` |
| User stories | `list_user_stories`, `get_user_story`, `create_user_story`, `update_user_story`, `delete_user_story` |
| Tasks | `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task` |
| Epics | `list_epics`, `get_epic`, `create_epic`, `update_epic`, `delete_epic` |
| Comments | `add_comment` on stories, tasks, and epics |

Items are addressed by their `#ref` numbers; statuses, assignees, and sprints are passed
by name. Deletion is permanent, so Claude confirms the specific item before removing it.

## Requirements

- Node.js 18 or newer (`node --version` to check)
- A Taiga account

## Updating

Maintainers push changes to this repository; users then run:

```
/plugin marketplace update taiga-marketplace
```

## Repository layout

```
.
├── .claude-plugin/
│   └── marketplace.json      # marketplace catalog (lists the plugin)
├── taiga-connector/          # the plugin itself
│   ├── .claude-plugin/plugin.json
│   ├── .mcp.json
│   ├── server/taiga-mcp.js
│   ├── skills/taiga/SKILL.md
│   └── README.md
└── README.md
```

## For maintainers

When changing the plugin, bump the `version` in both
`taiga-connector/.claude-plugin/plugin.json` and the matching entry in
`.claude-plugin/marketplace.json` so they stay in sync, then push.
Validate before pushing with `claude plugin validate .`.

## License

See the repository for license details.
