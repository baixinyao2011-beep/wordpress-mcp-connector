#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { createInterface } from "node:readline";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backupSettingsAfterError,
  backupSettingsAfterResult,
  createWordPressBackup,
  normalizeBackupSettings,
  shouldRunPreChangeBackup,
  updateStoredBackupStatus
} from "../lib/backup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(__dirname);
const DATA_FILE = path.join(ROOT_DIR, "data", "sites.json");
const KEY_FILE = path.join(ROOT_DIR, ".wp-connector-key");
const siteId = process.argv[2];

const PERMISSION_DEFINITIONS = [
  { key: "contentWrite", defaultEnabled: true },
  { key: "mediaUpload", defaultEnabled: true },
  { key: "taxonomyWrite", defaultEnabled: true },
  { key: "seoGeo", defaultEnabled: true },
  { key: "backupManage", defaultEnabled: true },
  { key: "cacheManage", defaultEnabled: false },
  { key: "menuWrite", defaultEnabled: false },
  { key: "settingsManage", defaultEnabled: false },
  { key: "codeSnippets", defaultEnabled: false },
  { key: "usersManage", defaultEnabled: false },
  { key: "pluginThemeManage", defaultEnabled: false },
  { key: "packageInstall", defaultEnabled: false },
  { key: "destructiveDelete", defaultEnabled: false }
];

if (!siteId) {
  console.error("Usage: run-wordpress-mcp.js <site-id>");
  process.exit(2);
}

function decryptText(value, key) {
  const [ivText, tagText, encryptedText] = String(value || "").split(".");
  if (!ivText || !tagText || !encryptedText) return "";
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function defaultPermissions() {
  return Object.fromEntries(PERMISSION_DEFINITIONS.map((item) => [item.key, item.defaultEnabled]));
}

function normalizePermissions(value) {
  const incoming = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const defaults = defaultPermissions();
  return Object.fromEntries(PERMISSION_DEFINITIONS.map((item) => [
    item.key,
    incoming[item.key] === undefined ? defaults[item.key] : Boolean(incoming[item.key])
  ]));
}

function permissionEnabled(site, key) {
  return Boolean(normalizePermissions(site.permissions)[key]);
}

function parseHeadersText(value) {
  const raw = String(value || "").trim();
  if (!raw) return {};

  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("CUSTOM_HEADERS JSON must be an object.");
    }
    return Object.fromEntries(Object.entries(parsed).map(([key, val]) => [key, String(val)]));
  }

  return Object.fromEntries(raw.split(",").map((pair) => {
    const index = pair.indexOf(":");
    if (index === -1) throw new Error("CUSTOM_HEADERS must use Header-Name: value format.");
    return [pair.slice(0, index).trim(), pair.slice(index + 1).trim()];
  }).filter(([header]) => header));
}

function mimeTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".avif": "image/avif",
    ".csv": "text/csv",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".webp": "image/webp",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip"
  };
  return types[ext] || "application/octet-stream";
}

function isImageMimeType(mimeType) {
  return String(mimeType || "").startsWith("image/");
}

function safeFilename(value) {
  const name = path.basename(String(value || "image").trim() || "image");
  return name.replace(/[\r\n"]/g, "_");
}

function wpApiUrl(siteUrl, apiPath) {
  return `${String(siteUrl || "").replace(/\/$/, "")}${apiPath}`;
}

function authHeadersForSite(site, env) {
  if (site.authMode === "application-password" && env.WP_API_USERNAME && env.WP_API_PASSWORD) {
    return {
      Authorization: `Basic ${Buffer.from(`${env.WP_API_USERNAME}:${env.WP_API_PASSWORD}`, "utf8").toString("base64")}`
    };
  }

  if (site.authMode === "jwt" && env.JWT_TOKEN) {
    return { Authorization: `Bearer ${env.JWT_TOKEN}` };
  }

  if (site.authMode === "custom-headers" && env.CUSTOM_HEADERS) {
    return parseHeadersText(env.CUSTOM_HEADERS);
  }

  throw new Error("Local media upload requires application-password, JWT, or custom-header auth in the connector.");
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

function localToolDefinitions() {
  const imageUploadTool = {
    name: "wordpress-upload-local-image",
    permission: "mediaUpload",
    title: "Upload Local Image to WordPress",
    description: "Uploads an image file from this computer to the configured WordPress media library using credentials stored in the local connector. Use this when WordPress abilities only accept a public image URL.",
    inputSchema: {
      type: "object",
      required: ["file_path"],
      properties: {
        file_path: {
          type: "string",
          description: "Absolute local path to an image file on this computer."
        },
        filename: {
          type: "string",
          description: "Optional filename to use in WordPress. Defaults to the local file basename."
        },
        title: {
          type: "string",
          description: "Optional media library title."
        },
        alt_text: {
          type: "string",
          description: "Optional image alt text."
        },
        caption: {
          type: "string",
          description: "Optional image caption."
        },
        description: {
          type: "string",
          description: "Optional image description."
        },
        post_id: {
          type: "integer",
          description: "Optional post ID. If provided, the uploaded image is set as the featured image for that post."
        }
      }
    }
  };

  const fileUploadTool = {
    name: "wordpress-upload-local-file",
    permission: "mediaUpload",
    title: "Upload Local File to WordPress",
    description: "Uploads a local file such as an image, PDF, document, spreadsheet, or zip to the configured WordPress media library. This does not install plugin or theme zip packages.",
    inputSchema: {
      type: "object",
      required: ["file_path"],
      properties: {
        file_path: {
          type: "string",
          description: "Absolute local path to a file on this computer."
        },
        filename: {
          type: "string",
          description: "Optional filename to use in WordPress. Defaults to the local file basename."
        },
        title: {
          type: "string",
          description: "Optional media library title."
        },
        alt_text: {
          type: "string",
          description: "Optional image alt text. WordPress ignores this for non-image media."
        },
        caption: {
          type: "string",
          description: "Optional media caption."
        },
        description: {
          type: "string",
          description: "Optional media description."
        },
        post_id: {
          type: "integer",
          description: "Optional post, page, or CPT item ID to attach the media to."
        },
        featured_media_for: {
          type: "object",
          description: "Optional target to set this upload as featured media. Provide id and rest_base, e.g. {\"id\": 123, \"rest_base\": \"posts\"} or {\"id\": 456, \"rest_base\": \"pages\"}.",
          properties: {
            id: { type: "integer" },
            rest_base: { type: "string" }
          }
        }
      }
    }
  };

  const taxonomyTermTool = {
    name: "wordpress-create-taxonomy-term",
    permission: "taxonomyWrite",
    title: "Create WordPress Taxonomy Term",
    description: "Creates a term in any REST-exposed WordPress taxonomy, including categories, tags, and custom taxonomies. Use this when a CPT taxonomy term must exist before assigning it.",
    inputSchema: {
      type: "object",
      required: ["taxonomy", "name"],
      properties: {
        taxonomy: {
          type: "string",
          description: "Taxonomy slug, e.g. category, post_tag, product_cat, or a custom taxonomy slug."
        },
        rest_base: {
          type: "string",
          description: "Optional REST base if the taxonomy cannot be discovered automatically."
        },
        name: {
          type: "string",
          description: "Term name."
        },
        slug: {
          type: "string",
          description: "Optional term slug."
        },
        description: {
          type: "string",
          description: "Optional term description."
        },
        parent: {
          type: "integer",
          description: "Optional parent term ID for hierarchical taxonomies."
        },
        meta: {
          type: "object",
          description: "Optional term meta fields when the taxonomy exposes meta in REST."
        }
      }
    }
  };

  const listMenusTool = {
    name: "wordpress-list-menus",
    permission: null,
    title: "List WordPress Menus",
    description: "Lists REST-exposed WordPress navigation menus and menu locations when the site supports the menu REST API.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  };

  const createMenuItemTool = {
    name: "wordpress-create-menu-item",
    permission: "menuWrite",
    title: "Create WordPress Menu Item",
    description: "Creates a navigation menu item through the WordPress menu REST API when available. Useful for adding a page, category, custom link, or CPT item to a menu.",
    inputSchema: {
      type: "object",
      required: ["menus", "title"],
      properties: {
        menus: {
          type: "integer",
          description: "Menu ID to add the item to."
        },
        title: {
          type: "string",
          description: "Menu item title."
        },
        type: {
          type: "string",
          description: "Menu item type: custom, post_type, taxonomy, or post_type_archive.",
          enum: ["custom", "post_type", "taxonomy", "post_type_archive"]
        },
        url: {
          type: "string",
          description: "URL for custom menu items."
        },
        object: {
          type: "string",
          description: "Object slug for post_type or taxonomy items, e.g. page, post, category."
        },
        object_id: {
          type: "integer",
          description: "Object ID for post_type or taxonomy items."
        },
        parent: {
          type: "integer",
          description: "Optional parent menu item ID."
        },
        menu_order: {
          type: "integer",
          description: "Optional menu item order."
        },
        status: {
          type: "string",
          description: "Menu item status.",
          enum: ["publish", "draft"]
        }
      }
    }
  };

  const llmsTextTool = {
    name: "wordpress-update-llms-text",
    permission: "seoGeo",
    title: "Update WordPress llms.txt",
    description: "Updates llms.txt or llms-full.txt through the optional WordPress MCP Connector Companion plugin. Returns a clear setup error if the companion plugin is not installed.",
    inputSchema: {
      type: "object",
      required: ["target", "content"],
      properties: {
        target: {
          type: "string",
          description: "Which file to update.",
          enum: ["llms.txt", "llms-full.txt"]
        },
        content: {
          type: "string",
          description: "Plain text content to serve."
        }
      }
    }
  };

  const companionStatusTool = {
    name: "wordpress-companion-status",
    permission: null,
    title: "Check WordPress Companion Plugin",
    description: "Checks whether the optional WordPress MCP Connector Companion plugin is active and which high-risk features are enabled.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  };

  const purgeLiteSpeedCacheTool = {
    name: "wordpress-purge-litespeed-cache",
    permission: "cacheManage",
    title: "Purge LiteSpeed Cache",
    description: "Purges LiteSpeed Cache through the optional WordPress MCP Connector Companion plugin. Supports full-site purge and targeted URL, post, post type, or object-cache purge.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "Cache purge scope.",
          enum: ["all", "url", "post", "post_type", "object"]
        },
        url: {
          type: "string",
          description: "URL or path to purge when mode is url."
        },
        post_id: {
          type: "integer",
          description: "Post ID to purge when mode is post."
        },
        post_type: {
          type: "string",
          description: "Post type slug to purge when mode is post_type."
        }
      }
    }
  };

  const createBackupTool = {
    name: "wordpress-create-local-backup",
    permission: "backupManage",
    title: "Create Local WordPress Backup",
    description: "Creates a local JSON recovery point for the configured WordPress site. The connector uses the companion backup export when available and falls back to WordPress REST content snapshots.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Optional short reason for this backup."
        },
        include_media_catalog: {
          type: "boolean",
          description: "Whether to include media-library metadata and source URLs. Binary media files are not downloaded."
        }
      }
    }
  };

  const installPackageTool = {
    name: "wordpress-install-local-package",
    permission: "packageInstall",
    title: "Install Local WordPress Plugin or Theme Zip",
    description: "Installs a local plugin or theme zip through the optional WordPress MCP Connector Companion plugin. The companion plugin must be installed and package installs must be explicitly enabled on the WordPress site.",
    inputSchema: {
      type: "object",
      required: ["file_path", "type"],
      properties: {
        file_path: {
          type: "string",
          description: "Absolute local path to a .zip package."
        },
        type: {
          type: "string",
          description: "Package type.",
          enum: ["plugin", "theme"]
        },
        activate: {
          type: "boolean",
          description: "Reserved for future use. The companion currently installs only; activation should be done separately through existing MCP abilities."
        }
      }
    }
  };

  return [
    imageUploadTool,
    fileUploadTool,
    taxonomyTermTool,
    listMenusTool,
    createMenuItemTool,
    llmsTextTool,
    companionStatusTool,
    purgeLiteSpeedCacheTool,
    createBackupTool,
    installPackageTool
  ];
}

function publicTool(tool) {
  const { permission, ...rest } = tool;
  return rest;
}

function requiredPermissionForAbility(abilityName) {
  const name = String(abilityName || "");

  if (/delete|trash|remove/i.test(name)) return "destructiveDelete";
  if (name === "ewpa/search-replace") return "contentWrite";

  if ([
    "ewpa/create-post",
    "ewpa/update-post",
    "ewpa/create-page",
    "ewpa/create-cpt-item",
    "ewpa/update-cpt-item",
    "hostinger-ai-assistant/posts-create",
    "hostinger-ai-assistant/posts-update",
    "hostinger-ai-assistant/pages-create",
    "hostinger-ai-assistant/pages-update",
    "hostinger-ai-assistant/cpt-create",
    "hostinger-ai-assistant/cpt-update"
  ].includes(name)) return "contentWrite";

  if ([
    "ewpa/upload-image",
    "hostinger-ai-assistant/media-update"
  ].includes(name)) return "mediaUpload";

  if (name.includes("categories-") || name.includes("tags-") || [
    "ewpa/create-category",
    "ewpa/create-tag",
    "ewpa/assign-cpt-terms"
  ].includes(name)) return "taxonomyWrite";

  if (name.includes("rank-math/") || name.includes("rankmath") || name.includes("yoast") || name.includes("seopress") || [
    "ewpa/update-post-meta"
  ].includes(name)) return "seoGeo";

  if (name === "ewpa/create-code-snippet") return "codeSnippets";

  if (name.includes("/users-") || name === "ewpa/get-users") return "usersManage";

  if (name.includes("theme-") || name.includes("plugin-")) return "pluginThemeManage";

  if (name.includes("wp-settings-update") || name.includes("hostinger-plugin-settings-update")) return "settingsManage";

  if (name.includes("litespeed-cache-flush") || name.includes("litespeed-cache-preset")) return "cacheManage";

  return null;
}

function ensurePermission(site, key, label) {
  if (key && !permissionEnabled(site, key)) {
    throw new Error(`Permission disabled: ${label || key}. Open the WordPress MCP connector dashboard and enable this permission for the site.`);
  }
}

function filterDiscoverAbilitiesPayload(payload, site) {
  if (!payload || !Array.isArray(payload.abilities)) return payload;
  return {
    ...payload,
    abilities: payload.abilities.filter((ability) => {
      const permission = requiredPermissionForAbility(ability.name);
      return !permission || permissionEnabled(site, permission);
    })
  };
}

function filterToolResultForPermissions(message, site) {
  const pendingItem = pending.get(message.id);
  if (!pendingItem || pendingItem.method !== "tools/call" || pendingItem.toolName !== "mcp-adapter-discover-abilities") {
    return message;
  }

  const content = message.result?.content;
  if (!Array.isArray(content)) return message;

  for (const item of content) {
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    try {
      const parsed = JSON.parse(item.text);
      const filtered = filterDiscoverAbilitiesPayload(parsed, site);
      item.text = JSON.stringify(filtered);
      if (message.result.structuredContent) {
        message.result.structuredContent = filterDiscoverAbilitiesPayload(message.result.structuredContent, site);
      }
    } catch {
      // Leave non-JSON content untouched.
    }
  }
  return message;
}

async function uploadLocalMedia(site, env, args, { imageOnly }) {
  const filePath = path.resolve(String(args.file_path || args.path || ""));
  if (!filePath) throw new Error("file_path is required.");

  const stats = await stat(filePath);
  if (!stats.isFile()) throw new Error("file_path must point to a file.");
  if (stats.size > 100 * 1024 * 1024) {
    throw new Error("File is larger than the 100 MB local connector limit.");
  }

  const body = await readFile(filePath);
  const filename = safeFilename(args.filename || filePath);
  const mimeType = mimeTypeForFile(filename);
  if (imageOnly && !isImageMimeType(mimeType)) {
    throw new Error("wordpress-upload-local-image only accepts image files. Use wordpress-upload-local-file for other media.");
  }

  const authHeaders = authHeadersForSite(site, env);
  const uploadResponse = await fetch(wpApiUrl(site.siteUrl || site.url, "/wp-json/wp/v2/media"), {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": mimeType,
      Accept: "application/json"
    },
    body,
    signal: AbortSignal.timeout(120000)
  });
  const uploaded = await readJsonResponse(uploadResponse);

  if (!uploadResponse.ok) {
    throw new Error(`WordPress media upload failed with HTTP ${uploadResponse.status}: ${uploaded.message || "Unknown error"}`);
  }

  const metadata = {};
  for (const key of ["title", "alt_text", "caption", "description"]) {
    if (args[key] !== undefined && args[key] !== null && String(args[key]).trim()) {
      metadata[key] = String(args[key]);
    }
  }

  let media = uploaded;
  if (Object.keys(metadata).length) {
    const metadataResponse = await fetch(wpApiUrl(site.siteUrl || site.url, `/wp-json/wp/v2/media/${uploaded.id}`), {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(metadata),
      signal: AbortSignal.timeout(30000)
    });
    media = await readJsonResponse(metadataResponse);
    if (!metadataResponse.ok) {
      throw new Error(`WordPress media metadata update failed with HTTP ${metadataResponse.status}: ${media.message || "Unknown error"}`);
    }
  }

  if (args.post_id !== undefined && args.post_id !== null && Number(args.post_id)) {
    const attachResponse = await fetch(wpApiUrl(site.siteUrl || site.url, `/wp-json/wp/v2/media/${uploaded.id}`), {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ post: Number(args.post_id) }),
      signal: AbortSignal.timeout(30000)
    });
    const attachResult = await readJsonResponse(attachResponse);
    if (!attachResponse.ok) {
      throw new Error(`WordPress media attachment failed with HTTP ${attachResponse.status}: ${attachResult.message || "Unknown error"}`);
    }
  }

  let setAsThumbnail = false;
  const featuredTarget = args.featured_media_for && typeof args.featured_media_for === "object"
    ? args.featured_media_for
    : imageOnly && args.post_id
      ? { id: args.post_id, rest_base: "posts" }
      : null;

  if (featuredTarget?.id && featuredTarget?.rest_base) {
    const restBase = String(featuredTarget.rest_base).replace(/^\/+|\/+$/g, "");
    const postResponse = await fetch(wpApiUrl(site.siteUrl || site.url, `/wp-json/wp/v2/${restBase}/${Number(featuredTarget.id)}`), {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ featured_media: uploaded.id }),
      signal: AbortSignal.timeout(30000)
    });
    const postResult = await readJsonResponse(postResponse);
    if (!postResponse.ok) {
      throw new Error(`Featured image update failed with HTTP ${postResponse.status}: ${postResult.message || "Unknown error"}`);
    }
    setAsThumbnail = true;
  }

  return {
    attachment_id: uploaded.id,
    url: media.source_url || uploaded.source_url || "",
    title: media.title?.rendered || uploaded.title?.rendered || args.title || filename,
    file: media.media_details?.file || uploaded.media_details?.file || "",
    mime_type: media.mime_type || uploaded.mime_type || mimeType,
    set_as_thumbnail: setAsThumbnail,
    post_id: args.post_id ? Number(args.post_id) : null,
    message: "Local file uploaded to WordPress media library."
  };
}

async function fetchWpJson(site, env, apiPath, options = {}) {
  const authHeaders = authHeadersForSite(site, env);
  const headers = {
    ...authHeaders,
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(wpApiUrl(site.siteUrl || site.url, apiPath), {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || 30000)
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`WordPress REST request failed with HTTP ${response.status}: ${payload.message || "Unknown error"}`);
  }
  return payload;
}

async function discoverTaxonomyRestBase(site, env, taxonomy, fallbackRestBase) {
  if (fallbackRestBase) return String(fallbackRestBase).replace(/^\/+|\/+$/g, "");
  const tax = await fetchWpJson(site, env, `/wp-json/wp/v2/taxonomies/${encodeURIComponent(taxonomy)}?context=edit`);
  if (!tax.rest_base) {
    throw new Error(`Taxonomy ${taxonomy} did not expose a REST base. Pass rest_base manually if it is REST-enabled.`);
  }
  return String(tax.rest_base).replace(/^\/+|\/+$/g, "");
}

async function createTaxonomyTerm(site, env, args) {
  const taxonomy = String(args.taxonomy || "").trim();
  const name = String(args.name || "").trim();
  if (!taxonomy) throw new Error("taxonomy is required.");
  if (!name) throw new Error("name is required.");

  const restBase = await discoverTaxonomyRestBase(site, env, taxonomy, args.rest_base);
  const body = { name };
  for (const key of ["slug", "description", "parent", "meta"]) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== "") body[key] = args[key];
  }

  const term = await fetchWpJson(site, env, `/wp-json/wp/v2/${restBase}`, {
    method: "POST",
    body
  });

  return {
    term_id: term.id,
    id: term.id,
    taxonomy,
    rest_base: restBase,
    name: term.name,
    slug: term.slug,
    link: term.link || "",
    message: "Taxonomy term created."
  };
}

async function listMenus(site, env) {
  const [menusResult, locationsResult] = await Promise.allSettled([
    fetchWpJson(site, env, "/wp-json/wp/v2/menus?context=edit&per_page=100"),
    fetchWpJson(site, env, "/wp-json/wp/v2/menu-locations")
  ]);

  if (menusResult.status === "rejected" && locationsResult.status === "rejected") {
    throw new Error(`WordPress menu REST API is unavailable: ${menusResult.reason.message}`);
  }

  return {
    menus: menusResult.status === "fulfilled" ? menusResult.value : [],
    locations: locationsResult.status === "fulfilled" ? locationsResult.value : {},
    warnings: [
      menusResult.status === "rejected" ? menusResult.reason.message : "",
      locationsResult.status === "rejected" ? locationsResult.reason.message : ""
    ].filter(Boolean)
  };
}

async function createMenuItem(site, env, args) {
  if (!Number(args.menus)) throw new Error("menus is required and must be a menu ID.");
  const title = String(args.title || "").trim();
  if (!title) throw new Error("title is required.");

  const body = {
    menus: Number(args.menus),
    title: { raw: title },
    type: args.type || (args.url ? "custom" : undefined),
    status: args.status || "publish"
  };

  for (const [source, target] of [
    ["url", "url"],
    ["object", "object"],
    ["object_id", "object_id"],
    ["parent", "parent"],
    ["menu_order", "menu_order"]
  ]) {
    if (args[source] !== undefined && args[source] !== null && args[source] !== "") body[target] = args[source];
  }

  const item = await fetchWpJson(site, env, "/wp-json/wp/v2/menu-items", {
    method: "POST",
    body
  });

  return {
    id: item.id,
    menus: item.menus,
    title: item.title?.rendered || title,
    url: item.url || "",
    type: item.type || body.type,
    message: "Menu item created."
  };
}

async function updateLlmsText(site, env, args) {
  const target = String(args.target || "").trim();
  const content = String(args.content || "");
  if (!["llms.txt", "llms-full.txt"].includes(target)) {
    throw new Error("target must be llms.txt or llms-full.txt.");
  }
  if (!content.trim()) throw new Error("content is required.");

  try {
    return await fetchWpJson(site, env, "/wp-json/wp-mcp-connector/v1/llms-text", {
      method: "POST",
      body: { target, content },
      timeoutMs: 30000
    });
  } catch (error) {
    throw new Error(`${error.message}. Install and activate the optional WordPress MCP Connector Companion plugin to manage ${target}.`);
  }
}

async function companionStatus(site, env) {
  try {
    return await fetchWpJson(site, env, "/wp-json/wp-mcp-connector/v1/status", {
      timeoutMs: 30000
    });
  } catch (error) {
    throw new Error(`${error.message}. The optional WordPress MCP Connector Companion plugin is not active on this site.`);
  }
}

async function purgeLiteSpeedCache(site, env, args) {
  const mode = String(args.mode || "all").trim();
  if (!["all", "url", "post", "post_type", "object"].includes(mode)) {
    throw new Error("mode must be one of all, url, post, post_type, or object.");
  }

  const body = { mode };
  if (mode === "url") {
    const url = String(args.url || "").trim();
    if (!url) throw new Error("url is required when mode is url.");
    body.url = url;
  }
  if (mode === "post") {
    const postId = Number.parseInt(args.post_id, 10);
    if (!Number.isInteger(postId) || postId <= 0) throw new Error("post_id is required when mode is post.");
    body.post_id = postId;
  }
  if (mode === "post_type") {
    const postType = String(args.post_type || "").trim();
    if (!postType) throw new Error("post_type is required when mode is post_type.");
    body.post_type = postType;
  }

  try {
    return await fetchWpJson(site, env, "/wp-json/wp-mcp-connector/v1/litespeed-cache/purge", {
      method: "POST",
      body,
      timeoutMs: 30000
    });
  } catch (error) {
    throw new Error(`${error.message}. Install and activate the optional WordPress MCP Connector Companion plugin, then enable the LiteSpeed 清缓存 permission for this site.`);
  }
}

async function installLocalPackage(site, env, args) {
  const filePath = path.resolve(String(args.file_path || args.path || ""));
  const type = String(args.type || "").trim();
  if (!filePath) throw new Error("file_path is required.");
  if (!["plugin", "theme"].includes(type)) throw new Error("type must be plugin or theme.");

  const filename = safeFilename(args.filename || filePath);
  if (path.extname(filename).toLowerCase() !== ".zip") {
    throw new Error("Only .zip WordPress packages are supported.");
  }

  const stats = await stat(filePath);
  if (!stats.isFile()) throw new Error("file_path must point to a file.");
  if (stats.size > 50 * 1024 * 1024) {
    throw new Error("Package is larger than the 50 MB companion plugin limit.");
  }

  const fileBase64 = (await readFile(filePath)).toString("base64");
  try {
    return await fetchWpJson(site, env, "/wp-json/wp-mcp-connector/v1/install-package", {
      method: "POST",
      body: {
        type,
        filename,
        file_base64: fileBase64,
        activate: Boolean(args.activate)
      },
      timeoutMs: 180000
    });
  } catch (error) {
    throw new Error(`${error.message}. Install and activate the optional WordPress MCP Connector Companion plugin, then explicitly enable package installs on the WordPress site.`);
  }
}

async function createLocalBackup(args = {}, trigger = "manual") {
  const settings = normalizeBackupSettings({
    ...site.backup,
    includeMediaCatalog: args.include_media_catalog ?? site.backup?.includeMediaCatalog
  });
  const record = await createWordPressBackup({
    rootDir: ROOT_DIR,
    site,
    authHeaders: authHeadersForSite(site, env),
    reason: String(args.reason || trigger),
    trigger,
    settings
  });
  const updated = await updateStoredBackupStatus(ROOT_DIR, site.id, (current) => backupSettingsAfterResult(current, record, trigger));
  site.backup = updated;
  return {
    id: record.id,
    createdAt: record.createdAt,
    trigger: record.trigger,
    source: record.source,
    filename: record.filename,
    filePath: record.filePath,
    sizeBytes: record.sizeBytes,
    warnings: record.warnings,
    message: "Local WordPress backup created."
  };
}

async function markBackupFailure(error, trigger) {
  const updated = await updateStoredBackupStatus(ROOT_DIR, site.id, (current) => backupSettingsAfterError(current, error, trigger));
  site.backup = updated;
}

async function refreshBackupSettings() {
  try {
    const latestStore = JSON.parse(await readFile(DATA_FILE, "utf8"));
    const latestSite = latestStore.sites.find((item) => item.id === site.id);
    if (latestSite) site.backup = normalizeBackupSettings(latestSite.backup);
  } catch {
    site.backup = normalizeBackupSettings(site.backup);
  }
}

async function ensurePreChangeBackup(permission, label) {
  await refreshBackupSettings();
  if (!shouldRunPreChangeBackup(site.backup, permission)) return;
  try {
    await createLocalBackup({ reason: `before ${label}` }, "pre-change");
  } catch (error) {
    await markBackupFailure(error, "pre-change").catch(() => {});
    throw new Error(`Pre-change backup failed, so ${label} was not executed: ${error.message}`);
  }
}

function writeMessage(stream, message) {
  stream.write(`${JSON.stringify(message)}\n`);
}

function toolResult(id, payload) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2)
        }
      ],
      structuredContent: payload
    }
  };
}

function toolErrorResult(id, error) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      isError: true,
      content: [
        {
          type: "text",
          text: error.message || "Local WordPress upload failed."
        }
      ]
    }
  };
}

const key = Buffer.from((await readFile(KEY_FILE, "utf8")).trim(), "base64");
const store = JSON.parse(await readFile(DATA_FILE, "utf8"));
const site = store.sites.find((item) => item.id === siteId);

if (!site) {
  console.error(`WordPress MCP site not found: ${siteId}`);
  process.exit(2);
}

const env = {
  ...process.env,
  WP_API_URL: site.endpointUrl,
  OAUTH_ENABLED: site.authMode === "oauth" ? "true" : "false"
};

if (site.authMode === "application-password") {
  env.WP_API_USERNAME = site.username || "";
  env.WP_API_PASSWORD = decryptText(site.passwordEncrypted, key);
}

if (site.authMode === "jwt") {
  env.JWT_TOKEN = decryptText(site.jwtEncrypted, key);
}

if (site.authMode === "custom-headers") {
  env.CUSTOM_HEADERS = decryptText(site.customHeadersEncrypted, key);
}

if (site.wooKey) env.WOO_CUSTOMER_KEY = site.wooKey;
if (site.wooSecretEncrypted) {
  env.WOO_CUSTOMER_SECRET = decryptText(site.wooSecretEncrypted, key);
}

const child = spawn("npx", ["-y", "@automattic/mcp-wordpress-remote"], {
  env,
  stdio: ["pipe", "pipe", "inherit"]
});

const pending = new Map();
const localTools = new Map(localToolDefinitions().map((tool) => [tool.name, tool]));
const localToolHandlers = {
  "wordpress-upload-local-image": (args) => uploadLocalMedia(site, env, args, { imageOnly: true }),
  "wordpress-upload-local-file": (args) => uploadLocalMedia(site, env, args, { imageOnly: false }),
  "wordpress-create-taxonomy-term": (args) => createTaxonomyTerm(site, env, args),
  "wordpress-list-menus": () => listMenus(site, env),
  "wordpress-create-menu-item": (args) => createMenuItem(site, env, args),
  "wordpress-update-llms-text": (args) => updateLlmsText(site, env, args),
  "wordpress-companion-status": () => companionStatus(site, env),
  "wordpress-purge-litespeed-cache": (args) => purgeLiteSpeedCache(site, env, args),
  "wordpress-create-local-backup": (args) => createLocalBackup(args, "manual"),
  "wordpress-install-local-package": (args) => installLocalPackage(site, env, args)
};

createInterface({ input: process.stdin }).on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    child.stdin.write(`${line}\n`);
    return;
  }

  if (message.method === "tools/list" && message.id !== undefined) {
    pending.set(message.id, { method: "tools/list" });
    writeMessage(child.stdin, message);
    return;
  }

  if (message.method === "tools/call" && localToolHandlers[message.params?.name] && message.id !== undefined) {
    try {
      const tool = localTools.get(message.params.name);
      ensurePermission(site, tool?.permission, tool?.title || message.params.name);
      await ensurePreChangeBackup(tool?.permission, tool?.title || message.params.name);
      const payload = await localToolHandlers[message.params.name](message.params.arguments || {});
      writeMessage(process.stdout, toolResult(message.id, payload));
    } catch (error) {
      writeMessage(process.stdout, toolErrorResult(message.id, error));
    }
    return;
  }

  if (message.method === "tools/call" && message.params?.name === "mcp-adapter-execute-ability" && message.id !== undefined) {
    try {
      const abilityName = message.params.arguments?.ability_name;
      const permission = requiredPermissionForAbility(abilityName);
      ensurePermission(site, permission, abilityName);
      await ensurePreChangeBackup(permission, abilityName);
    } catch (error) {
      writeMessage(process.stdout, toolErrorResult(message.id, error));
      return;
    }
  }

  if (message.method === "tools/call" && message.id !== undefined) {
    pending.set(message.id, {
      method: "tools/call",
      toolName: message.params?.name
    });
  }

  writeMessage(child.stdin, message);
});

createInterface({ input: child.stdout }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(`${line}\n`);
    return;
  }

  if (message.id !== undefined && pending.get(message.id)?.method === "tools/list") {
    pending.delete(message.id);
    if (message.result && Array.isArray(message.result.tools)) {
      message.result.tools.push(...[...localTools.values()]
        .filter((tool) => !tool.permission || permissionEnabled(site, tool.permission))
        .map(publicTool));
    }
  }

  if (message.id !== undefined && pending.get(message.id)?.method === "tools/call") {
    filterToolResultForPermissions(message, site);
    pending.delete(message.id);
  }

  writeMessage(process.stdout, message);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
