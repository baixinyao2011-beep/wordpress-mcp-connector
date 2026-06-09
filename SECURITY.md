# Security Notes

This project is designed to keep WordPress credentials out of chat transcripts and MCP client config files.

Do not commit these local files:

- `.wp-connector-key`
- `data/sites.json`
- `data/users.json`
- `data/runtime.json`
- `data/backups/`
- `.env`

If a WordPress Application Password, JWT token, bearer token, or custom API header has appeared in a chat transcript, issue tracker, Git history, or log file, revoke it in WordPress immediately and create a new credential.

Use a dedicated WordPress user for MCP access whenever possible. Grant only the permissions needed for the intended workflow.

The local web UI binds to `127.0.0.1` by default and uses a random high port on
first start. Do not expose it to the public internet.

The dashboard requires a local administrator login. Create this user on first
open. Use a strong password because this dashboard controls WordPress credentials
and permissions.

State-changing dashboard API requests reject unexpected browser origins. Keep
the dashboard on loopback and do not reverse-proxy it publicly.

The optional WordPress companion plugin includes guarded plugin/theme package
installation endpoints. These endpoints are disabled by default and require
explicit per-site enablement from the local MCP dashboard. Keep package installs
disabled except during short, intentional maintenance windows for trusted
packages.

Local recovery points do not include WordPress credentials, but they can include
draft content, SEO metadata, menus, taxonomy structure, media URLs, and other
private site data. Treat `data/backups/` as sensitive local data.

Recommended defaults:

- Keep destructive delete disabled.
- Keep plugin/theme management disabled.
- Keep local `.zip` package installs disabled.
- Enable users, settings, and code snippets only for intentional short tasks.
