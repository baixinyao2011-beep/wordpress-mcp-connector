# Workbuddy Deployment Guide

## 1. Clone and Start

```bash
git clone <your-github-repo-url>
cd wordpress-mcp-connector
npm start
```

Open:

```text
Use the local URL printed by `npm start`.
```

Node.js 20 or newer is required.

The dashboard uses a random high port on first start and stores it locally in
`data/runtime.json`. Do not hard-code or publish the dashboard URL.

On first open, create a local administrator account. This protects the local
dashboard and is separate from WordPress users.

## 2. WordPress Site Requirements

Install and enable:

- `WordPress/mcp-adapter`: required base MCP endpoint
- `Enable Abilities for MCP`: install from wp-admin plugin search; required for practical content, SEO, CPT, media, taxonomy, and post meta abilities
- `WordPress MCP Connector Companion`: included in this repository; required for `/llms.txt`, `/llms-full.txt`, LiteSpeed Cache purges, local `.zip` package installs, and companion permission sync

The default MCP endpoint is:

```text
https://example.com/wp-json/mcp/mcp-adapter-default-server
```

MCP Adapter GitHub:

```text
https://github.com/WordPress/mcp-adapter
```

Companion plugin GitHub:

```text
https://github.com/baixinyao2011-beep/wordpress-mcp-connector/tree/main/wordpress-plugin/wordpress-mcp-connector-companion
```

## 3. Add a Site in the Local UI

Use the local web UI to enter:

- Site name
- MCP server name
- Site URL
- MCP endpoint URL
- Auth method
- WordPress Application Password, JWT, OAuth, or custom headers

Credentials are encrypted locally and should never be pasted into chat.

## 4. Copy MCP Config

After saving and testing the endpoint, click `Copy Config`.

The generated config references the local runner:

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

This config does not contain the WordPress password or token.

## 5. Never Commit Local Secrets

These files are intentionally ignored by Git:

- `.wp-connector-key`
- `data/sites.json`
- `.env`

Each machine should generate its own local key and local site database.

Also keep these local-only files private:

- `data/users.json`
- `data/runtime.json`

## 6. Local Files, Taxonomies, Menus, and GEO Helpers

The local runner adds several tools in addition to the remote WordPress MCP
abilities:

- `wordpress-upload-local-image`: local image path to WordPress media library
- `wordpress-upload-local-file`: local PDF/document/spreadsheet/media file to WordPress media library
- `wordpress-create-taxonomy-term`: create a category, tag, or custom taxonomy term
- `wordpress-list-menus`: list REST-exposed menus and menu locations
- `wordpress-create-menu-item`: add a menu item when the menu REST API is available
- `wordpress-companion-status`: check optional companion plugin status
- `wordpress-create-local-backup`: create a local JSON recovery point
- `wordpress-update-llms-text`: update `/llms.txt` or `/llms-full.txt` through the companion plugin
- `wordpress-purge-litespeed-cache`: purge LiteSpeed Cache through the companion plugin
- `wordpress-install-local-package`: install a local plugin/theme `.zip` through the companion plugin

For local images, upload first and then pass the returned `attachment_id` as
`featured_image_id` when creating or updating a post.

## 7. Optional WordPress Companion Plugin

The companion plugin lives here:

```text
wordpress-plugin/wordpress-mcp-connector-companion
```

GitHub download location:

```text
https://github.com/baixinyao2011-beep/wordpress-mcp-connector/tree/main/wordpress-plugin/wordpress-mcp-connector-companion
```

Install it in WordPress only when the site needs MCP-managed `/llms.txt`,
`/llms-full.txt`, richer local backup exports, or guarded local plugin/theme
package installs.

Package installs are disabled by default. To enable them, add this to a trusted
site connection in the local MCP dashboard, turn on `本地 zip 安装`, and save.
Saving attempts to sync the setting to the companion plugin. Keep package
installs disabled when not actively installing a trusted package.

If the local dashboard reports that the feature cannot be enabled because the
companion plugin did not respond, install or update the WordPress plugin above,
activate it in wp-admin, then save the site connection again.
