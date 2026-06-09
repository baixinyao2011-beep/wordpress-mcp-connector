# WordPress MCP Connector

Local WordPress MCP connector with an encrypted credential store and a web management UI.

[中文说明](README.zh-CN.md)

It does not reimplement WordPress MCP. It wraps the existing WordPress MCP ecosystem:

- WordPress site plugin: [`WordPress/mcp-adapter`](https://github.com/WordPress/mcp-adapter)
- Local MCP proxy: [`@automattic/mcp-wordpress-remote`](https://www.npmjs.com/package/@automattic/mcp-wordpress-remote)
- This app: local site management, encrypted authorization storage, MCP client config generation

## Why This Exists

WordPress authorization values should not be pasted into chat windows or MCP client config files.

This app keeps credentials in a local encrypted store. The generated MCP config only references a local runner script and a local site ID.

## Requirements

- Node.js 20 or newer
- A WordPress site with `WordPress/mcp-adapter` installed
- Optional: `Enable Abilities for MCP` if you need content, SEO, CPT, WooCommerce, or other WordPress abilities

## Start

```bash
npm start
```

By default the dashboard chooses a random high port on first start and stores it
in `data/runtime.json`. Do not share this local URL publicly. Set `PORT` only if
you explicitly need a fixed port.

Open the local URL printed by `npm start`. On first open, create a local
administrator account. This account protects only the local dashboard.

## WordPress Setup

Install and enable MCP Adapter on each WordPress site. MCP Adapter is required
for the base MCP endpoint:

```text
https://github.com/WordPress/mcp-adapter
```

Default MCP endpoint:

```text
https://your-site.example/wp-json/mcp/mcp-adapter-default-server
```

For practical article, page, SEO, GEO, CPT, media, post meta, and taxonomy
abilities, install `Enable Abilities for MCP` from the WordPress admin plugin
directory:

```text
Plugins -> Add New Plugin -> search "Enable Abilities for MCP"
```

For `/llms.txt`, `/llms-full.txt`, companion-side backup exports, LiteSpeed
Cache purges, local plugin/theme `.zip` installs, and companion-side permission
sync, install the optional companion plugin included in this repository:

```text
wordpress-plugin/wordpress-mcp-connector-companion
```

Ready-to-upload ZIP:

```text
wordpress-plugin/wordpress-mcp-connector-companion.zip
```

See [docs/installation.md](docs/installation.md) for full installation steps.

## Add a Site

In the local UI, add:

- Site name
- MCP server name
- Site URL
- MCP endpoint URL
- Auth method
- WordPress Application Password, JWT, OAuth, or custom headers

Recommended auth method for teams: WordPress Application Passwords from a dedicated WordPress user.

## MCP Client Config

After saving a site, click `Test Endpoint`, then `Copy Config`.

The generated config looks like this:

```json
{
  "mcpServers": {
    "wordpress-example-com": {
      "command": "node",
      "args": [
        "/absolute/path/to/bin/run-wordpress-mcp.js",
        "site-id"
      ]
    }
  }
}
```

The config does not include WordPress credentials. At runtime, `bin/run-wordpress-mcp.js` reads the local encrypted store and launches:

```bash
npx -y @automattic/mcp-wordpress-remote
```

## Local Uploads and Site Operations

Some WordPress abilities, including `ewpa/upload-image`, can only import images
from a public URL. The local runner adds local MCP tools for files that are
already on this computer.

```text
wordpress-upload-local-image
wordpress-upload-local-file
```

Use `wordpress-upload-local-image` before creating or updating a post when the
source image is local. Use `wordpress-upload-local-file` for PDFs, documents,
spreadsheets, and other media-library files. These tools
uploads the file directly to `/wp-json/wp/v2/media` with the credentials stored
in this connector, then returns the WordPress attachment ID and media URL.

Example tool arguments:

```json
{
  "file_path": "/absolute/path/to/image.jpg",
  "title": "Image title",
  "alt_text": "Descriptive alt text",
  "post_id": 123
}
```

Then pass the returned `attachment_id` as `featured_image_id` when calling
`ewpa/create-post`, or insert the returned `url` into the post HTML.

The local runner also adds:

```text
wordpress-create-taxonomy-term
wordpress-list-menus
wordpress-create-menu-item
wordpress-companion-status
wordpress-create-local-backup
wordpress-update-llms-text
wordpress-purge-litespeed-cache
wordpress-install-local-package
```

- `wordpress-create-taxonomy-term` creates terms in REST-exposed taxonomies,
  including custom taxonomies used by CPTs.
- `wordpress-list-menus` and `wordpress-create-menu-item` work when the site's
  WordPress REST menu endpoints are available.
- `wordpress-update-llms-text`, `wordpress-purge-litespeed-cache`, and
  `wordpress-install-local-package` require the optional companion plugin below.
- `wordpress-purge-litespeed-cache` supports full-site, URL, post, post type,
  and object-cache purge modes when LiteSpeed Cache is active and the site's
  `LiteSpeed 清缓存` permission switch is enabled.
- `wordpress-create-local-backup` creates a local JSON recovery point. The local
  runner can also create pre-change recovery points automatically when a site's
  dashboard backup strategy enables it. New site connections default to backup
  strategy off until you explicitly enable one.

## Optional WordPress Companion Plugin

The repository includes an optional WordPress plugin:

```text
wordpress-plugin/wordpress-mcp-connector-companion
```

GitHub download location:

```text
https://github.com/baixinyao2011-beep/wordpress-mcp-connector/tree/main/wordpress-plugin/wordpress-mcp-connector-companion
```

Install it in WordPress only if you need:

- `/llms.txt` or `/llms-full.txt` management from MCP
- companion-side JSON backup exports for richer local recovery points
- LiteSpeed Cache purge requests from MCP
- guarded local `.zip` plugin/theme package installs

For safety, local plugin/theme package installs are disabled by default even
after the companion plugin is activated. Enable or disable them from the local
MCP management page's permission switches for each site. Saving the switches
also attempts to sync the companion plugin permissions.

If saving shows a companion sync failure, it means the required companion plugin
is not installed, not active, or older than the current connector version.

Keep package installs disabled unless you are actively installing a trusted
package. Package activation remains separate and should use existing WordPress
plugin/theme activation abilities after review.

## Auth Methods

- OAuth: recommended when available. The MCP client handles browser authorization.
- Application Password: WordPress username plus an application password.
- JWT: server-to-server token setups.
- Headers: custom `CUSTOM_HEADERS` for API keys or reverse proxy auth.
- WooCommerce: optional `WOO_CUSTOMER_KEY` and `WOO_CUSTOMER_SECRET`.

## Local Sensitive Files

Do not commit these files:

- `data/sites.json`
- `data/users.json`
- `data/runtime.json`
- `.wp-connector-key`
- `.env`

They are ignored by Git. Each machine should create its own local key and site database.

## Safety Checklist

- Use a dedicated WordPress user for MCP.
- Revoke any credential that appears in a chat transcript, issue, Git history, or log.
- Enable only necessary WordPress abilities.
- Avoid exposing delete, user-management, theme-file, or plugin-file abilities unless you are working in a test environment.
- Keep the local web UI bound to `127.0.0.1`.

## Workbuddy Deployment

See [docs/workbuddy-deploy.md](docs/workbuddy-deploy.md).

For full setup and WordPress plugin requirements, see
[docs/installation.md](docs/installation.md).

## Capability Notes

See [docs/capabilities.md](docs/capabilities.md) for the current coverage and
known boundaries around media, taxonomies, menus, SEO, GEO, themes, and plugins.
