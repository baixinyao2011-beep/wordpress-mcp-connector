# WordPress MCP Connector Capabilities

This connector combines remote WordPress MCP abilities with local helper tools.

## Content

- Create, read, update, and delete posts through WordPress MCP abilities.
- Create and update pages through WordPress MCP abilities.
- Create and update custom post type items when the CPT is REST-exposed.
- Assign terms to CPT items.

## Media

- `ewpa/upload-image` imports images from public URLs.
- `wordpress-upload-local-image` uploads local image files to the media library.
- `wordpress-upload-local-file` uploads local PDFs, documents, spreadsheets, and other media-library files.

Local media upload returns an attachment ID and source URL. Use the attachment ID
as `featured_image_id` for posts or as `featured_media` through the relevant
WordPress update ability.

## Taxonomies and Sections

- Standard categories and tags can be created through WordPress abilities.
- `wordpress-create-taxonomy-term` can create terms in REST-exposed custom taxonomies.
- `ewpa/assign-cpt-terms` can assign existing terms to CPT items.

If a taxonomy is not REST-exposed by the WordPress site, the connector cannot
create or assign its terms without a WordPress-side extension.

## Menus and Navigation

- `wordpress-list-menus` lists menus and locations when the WordPress menu REST API is available.
- `wordpress-create-menu-item` creates menu items when the WordPress menu REST API is available.

Theme template parts, block patterns, widgets, and full-site editing templates
are not covered by the current local runner unless the site exposes them through
REST or a custom companion plugin.

## SEO and GEO

Supported through remote abilities:

- Rank Math metadata and focus keywords.
- Rank Math schema blocks such as Article, FAQPage, Product, LocalBusiness, Organization, and Person.
- Yoast and SEOPress metadata when those plugins are active.
- Exact post meta reads/writes for known SEO or GEO-related custom fields.

Supported through the optional companion plugin:

- `/llms.txt`
- `/llms-full.txt`
- richer JSON backup exports for local recovery points
- LiteSpeed Cache purge requests

Not included yet:

- Citation tracking across AI answer engines.
- Automated entity database management.
- A dedicated GEO scoring workflow.

## Backup Recovery Points

- `wordpress-create-local-backup` creates a local JSON recovery point.
- Dashboard strategies can run backups on a schedule and before write/delete operations.
- The fallback snapshot uses standard WordPress REST content, taxonomy, menu, and media catalog endpoints when the companion plugin is unavailable or outdated.

Recovery points do not include WordPress credentials, media binaries, server
files, or full database dumps. Keep host-level or plugin-level full-site backups
enabled for complete disaster recovery.

## Themes and Plugins

Remote abilities can install themes and plugins from WordPress.org by slug.

Local `.zip` package installs require the optional WordPress companion plugin and
are disabled by default. Enable them from the local MCP dashboard only for
trusted packages during intentional maintenance.

Companion plugin download location:

```text
https://github.com/baixinyao2011-beep/wordpress-mcp-connector/tree/main/wordpress-plugin/wordpress-mcp-connector-companion
```

If the dashboard says a companion-backed feature failed to enable, the WordPress
site has not registered the companion REST endpoints. Install, activate, or
update the companion plugin in wp-admin and save the connector permissions again.

Package activation remains separate and should use existing WordPress activation
abilities after review.
