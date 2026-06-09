# Installation Guide

This guide is for sharing the connector with another person or deploying it on a
new computer.

## 1. Start the Local Connector

Requirements:

- Node.js 20 or newer
- Git, or a downloaded ZIP of this repository

Start the local dashboard:

```bash
npm start
```

The dashboard chooses a random high port on first start. Use the URL printed in
the terminal, for example:

```text
WordPress MCP connector is running at http://127.0.0.1:54321
```

The port is stored locally in `data/runtime.json`. Do not hard-code or publish
this URL.

On first open, create a local administrator. This account protects the local
dashboard only. It is not a WordPress account and is not sent to WordPress.

## 2. Required WordPress Plugins

Install these in each WordPress site that should be managed through MCP.

### MCP Adapter

Required. This provides the base WordPress MCP endpoint.

GitHub:

```text
https://github.com/WordPress/mcp-adapter
```

After activation, the default endpoint is usually:

```text
https://example.com/wp-json/mcp/mcp-adapter-default-server
```

### Enable Abilities for MCP

Required for practical content operations such as posts, pages, categories,
media, SEO fields, Rank Math metadata, custom post types, and similar abilities.

Install from WordPress admin:

```text
Plugins -> Add New Plugin -> search "Enable Abilities for MCP" -> Install -> Activate
```

Then open its settings and enable only the abilities needed for the site.

### WordPress MCP Connector Companion

Required only for companion-backed features:

- `/llms.txt`
- `/llms-full.txt`
- richer local backup exports
- LiteSpeed Cache purge requests
- local plugin/theme `.zip` package installs
- syncing companion-side high-risk permissions from the local dashboard

GitHub:

```text
https://github.com/baixinyao2011-beep/wordpress-mcp-connector/tree/main/wordpress-plugin/wordpress-mcp-connector-companion
```

Ready-to-upload ZIP in this project:

```text
wordpress-plugin/wordpress-mcp-connector-companion.zip
```

WordPress admin upload path:

```text
Plugins -> Add New Plugin -> Upload Plugin
```

If the local dashboard says a feature cannot be enabled because the companion
plugin did not respond, install or update this companion plugin, activate it in
wp-admin, then save the connector permissions again.

## 3. Add the WordPress Site

In the local dashboard:

1. Add the site name and site URL.
2. Add the MCP endpoint URL.
3. Choose the auth method.
4. Use a dedicated WordPress user and WordPress Application Password whenever possible.
5. Save the site.
6. Test the endpoint.
7. Copy the generated MCP client config.

Credentials are encrypted locally. Do not paste WordPress passwords or tokens
into chat.

## 4. Permissions

Each site has local permission switches. Common content operations are enabled
by default. High-risk permissions are disabled by default:

- menu write
- site settings
- LiteSpeed Cache purge
- code snippets
- users
- plugin/theme management
- local `.zip` package install
- destructive delete

Enable high-risk permissions only for the shortest practical maintenance window,
then turn them off again.

## 5. Local Sensitive Files

Do not commit or share:

- `data/sites.json`
- `data/users.json`
- `data/runtime.json`
- `.wp-connector-key`
- `.env`

These files are machine-local and are ignored by Git.
