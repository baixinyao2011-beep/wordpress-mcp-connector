# Codex Plugin Companion

This repository includes a sanitized Codex plugin companion at:

```text
plugins/wordpress-mcp-connector
```

The plugin does not include WordPress site IDs, credentials, tokens, or local encrypted data.

## What the Plugin Provides

- A Codex plugin card for WordPress MCP work
- A reusable `wordpress-mcp` skill
- A script that opens the local dashboard at `http://127.0.0.1:8787`
- Safety guidance that keeps credentials out of chat

## Local Dashboard Opener

The opener script is:

```text
plugins/wordpress-mcp-connector/scripts/open-manager.mjs
```

By default it opens:

```text
http://127.0.0.1:8787
```

To let the opener start the local dashboard automatically, set:

```bash
export WORDPRESS_MCP_CONNECTOR_ROOT="/absolute/path/to/wordpress-mcp-connector"
```

Optional custom URL:

```bash
export WORDPRESS_MCP_CONNECTOR_URL="http://127.0.0.1:8787"
```

## MCP Server Setup

The plugin intentionally does not ship a `.mcp.json` with site-specific MCP servers.

Use the local dashboard to add WordPress sites and copy the generated MCP config into Codex or your MCP client. This avoids publishing site IDs or credentials.

## Install as a Personal Plugin

One option is to copy or symlink the plugin into your personal Codex plugins directory and add it to your personal marketplace.

Example layout:

```text
~/plugins/wordpress-mcp-connector
~/.agents/plugins/marketplace.json
```

A marketplace example is provided at:

```text
.agents/plugins/marketplace.example.json
```

Adjust paths as needed for your local Codex setup.
