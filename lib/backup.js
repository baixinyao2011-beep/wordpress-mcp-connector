import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const BACKUP_STRATEGIES = [
  {
    key: "daily-guarded",
    label: "每日守护",
    description: "每天自动备份一次，并在写入或删除前先留一个恢复点。",
    enabled: true,
    intervalHours: 24,
    beforeWriteBackup: true,
    preChangeCooldownMinutes: 60,
    includeMediaCatalog: true,
    retention: 21
  },
  {
    key: "high-frequency",
    label: "高频保护",
    description: "每 6 小时自动备份一次，适合近期会频繁改站点时使用。",
    enabled: true,
    intervalHours: 6,
    beforeWriteBackup: true,
    preChangeCooldownMinutes: 15,
    includeMediaCatalog: true,
    retention: 60
  },
  {
    key: "content-light",
    label: "轻量内容",
    description: "每天备份文章、页面、分类和媒体清单，保留更少恢复点。",
    enabled: true,
    intervalHours: 24,
    beforeWriteBackup: true,
    preChangeCooldownMinutes: 120,
    includeMediaCatalog: false,
    retention: 14
  },
  {
    key: "manual",
    label: "手动备份",
    description: "只在 dashboard 或 MCP 工具手动触发备份。",
    enabled: true,
    intervalHours: null,
    beforeWriteBackup: false,
    preChangeCooldownMinutes: 0,
    includeMediaCatalog: true,
    retention: 10
  },
  {
    key: "off",
    label: "关闭备份",
    description: "不自动备份，也不在写入前创建恢复点。",
    enabled: false,
    intervalHours: null,
    beforeWriteBackup: false,
    preChangeCooldownMinutes: 0,
    includeMediaCatalog: false,
    retention: 0
  }
];

const DEFAULT_STRATEGY = "off";
const WRITE_PERMISSIONS = new Set([
  "contentWrite",
  "mediaUpload",
  "taxonomyWrite",
  "seoGeo",
  "menuWrite",
  "settingsManage",
  "codeSnippets",
  "usersManage",
  "pluginThemeManage",
  "packageInstall",
  "destructiveDelete"
]);
const INTERNAL_POST_TYPES_TO_SKIP = new Set(["wp_global_styles"]);

function strategyForKey(key) {
  return BACKUP_STRATEGIES.find((strategy) => strategy.key === key) || BACKUP_STRATEGIES.find((strategy) => strategy.key === DEFAULT_STRATEGY);
}

function numberOrDefault(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null && fallback === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function backupStrategiesForClient() {
  return BACKUP_STRATEGIES.map((strategy) => ({
    key: strategy.key,
    label: strategy.label,
    description: strategy.description,
    enabled: strategy.enabled,
    intervalHours: strategy.intervalHours,
    beforeWriteBackup: strategy.beforeWriteBackup,
    preChangeCooldownMinutes: strategy.preChangeCooldownMinutes,
    includeMediaCatalog: strategy.includeMediaCatalog,
    retention: strategy.retention
  }));
}

export function normalizeBackupSettings(value = {}) {
  const incoming = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const strategy = strategyForKey(incoming.strategy || DEFAULT_STRATEGY);
  const enabled = strategy.key === "off" ? false : Boolean(incoming.enabled ?? strategy.enabled);
  const intervalHours = strategy.intervalHours === null
    ? null
    : numberOrDefault(incoming.intervalHours, strategy.intervalHours, { min: 1, max: 24 * 14 });

  return {
    strategy: strategy.key,
    label: strategy.label,
    enabled,
    intervalHours,
    beforeWriteBackup: Boolean(incoming.beforeWriteBackup ?? strategy.beforeWriteBackup),
    preChangeCooldownMinutes: numberOrDefault(
      incoming.preChangeCooldownMinutes,
      strategy.preChangeCooldownMinutes,
      { min: 0, max: 24 * 60 }
    ),
    includeMediaCatalog: Boolean(incoming.includeMediaCatalog ?? strategy.includeMediaCatalog),
    retention: numberOrDefault(incoming.retention, strategy.retention, { min: 0, max: 365 }),
    lastRunAt: incoming.lastRunAt || null,
    lastManualRunAt: incoming.lastManualRunAt || null,
    lastPreChangeAt: incoming.lastPreChangeAt || null,
    lastStatus: incoming.lastStatus || null,
    updatedAt: incoming.updatedAt || null
  };
}

export function backupDue(settings, now = new Date()) {
  const normalized = normalizeBackupSettings(settings);
  if (!normalized.enabled || !normalized.intervalHours) return false;
  if (!normalized.lastRunAt) return true;
  const lastRun = new Date(normalized.lastRunAt).getTime();
  if (!Number.isFinite(lastRun)) return true;
  return now.getTime() - lastRun >= normalized.intervalHours * 60 * 60 * 1000;
}

export function shouldRunPreChangeBackup(settings, permission, now = new Date()) {
  const normalized = normalizeBackupSettings(settings);
  if (!normalized.enabled || !normalized.beforeWriteBackup || !WRITE_PERMISSIONS.has(permission)) return false;
  if (!normalized.lastPreChangeAt) return true;
  const lastRun = new Date(normalized.lastPreChangeAt).getTime();
  if (!Number.isFinite(lastRun)) return true;
  return now.getTime() - lastRun >= normalized.preChangeCooldownMinutes * 60 * 1000;
}

function safeSlug(value) {
  return String(value || "wordpress-site")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "wordpress-site";
}

function backupDir(rootDir, site) {
  const source = site.serverName || site.name || site.siteUrl || site.url || site.id;
  return path.join(rootDir, "data", "backups", `${safeSlug(source)}-${String(site.id || "").slice(0, 8)}`);
}

function wpApiUrl(site, apiPath) {
  return `${String(site.siteUrl || site.url || "").replace(/\/$/, "")}${apiPath}`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

async function fetchWpJson(site, authHeaders, apiPath, options = {}) {
  const response = await (options.fetchImpl || fetch)(wpApiUrl(site, apiPath), {
    method: options.method || "GET",
    headers: {
      ...authHeaders,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || 30000)
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const error = new Error(payload.message || `WordPress REST returned HTTP ${response.status}`);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }
  return { payload, headers: response.headers };
}

async function fetchCollection(site, authHeaders, basePath, params = {}, options = {}) {
  const items = [];
  const warnings = [];
  const maxPages = options.maxPages || 50;
  const perPage = options.perPage || 100;

  for (let page = 1; page <= maxPages; page += 1) {
    const search = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""))
    });

    let result;
    try {
      result = await fetchWpJson(site, authHeaders, `${basePath}?${search.toString()}`, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs || 45000
      });
    } catch (error) {
      if (page === 1 && params.context === "edit") {
        warnings.push(`${basePath}: edit context unavailable, retried with view context.`);
        return fetchCollection(site, authHeaders, basePath, { ...params, context: undefined }, options);
      }
      throw error;
    }

    const pageItems = Array.isArray(result.payload) ? result.payload : [];
    items.push(...pageItems);
    const totalPages = Number(result.headers.get("x-wp-totalpages") || 1);
    if (!pageItems.length || page >= totalPages) break;
  }

  return { items, warnings };
}

async function tryFetch(site, authHeaders, apiPath, options = {}) {
  try {
    return (await fetchWpJson(site, authHeaders, apiPath, options)).payload;
  } catch (error) {
    options.warnings?.push(`${apiPath}: ${error.message}`);
    return null;
  }
}

function normalizeRestBase(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

async function fallbackRestSnapshot(site, authHeaders, settings, fetchImpl) {
  const warnings = [];
  const generatedAt = new Date().toISOString();
  const index = await tryFetch(site, authHeaders, "/wp-json", { fetchImpl, warnings, timeoutMs: 30000 });
  const typesPayload = await tryFetch(site, authHeaders, "/wp-json/wp/v2/types?context=edit", { fetchImpl, warnings, timeoutMs: 30000 })
    || await tryFetch(site, authHeaders, "/wp-json/wp/v2/types", { fetchImpl, warnings, timeoutMs: 30000 })
    || {};
  const taxonomiesPayload = await tryFetch(site, authHeaders, "/wp-json/wp/v2/taxonomies?context=edit", { fetchImpl, warnings, timeoutMs: 30000 })
    || await tryFetch(site, authHeaders, "/wp-json/wp/v2/taxonomies", { fetchImpl, warnings, timeoutMs: 30000 })
    || {};
  const settingsPayload = await tryFetch(site, authHeaders, "/wp-json/wp/v2/settings", { fetchImpl, warnings, timeoutMs: 30000 });

  const postTypes = Object.entries(typesPayload)
    .map(([slug, definition]) => ({
      slug,
      name: definition.name,
      rest_base: normalizeRestBase(definition.rest_base || definition.rest_namespace && slug),
      description: definition.description || "",
      hierarchical: Boolean(definition.hierarchical),
      taxonomies: Array.isArray(definition.taxonomies) ? definition.taxonomies : []
    }))
    .filter((type) => type.rest_base && type.slug !== "attachment" && !INTERNAL_POST_TYPES_TO_SKIP.has(type.slug) && !/[()?]/.test(type.rest_base));

  if (!postTypes.some((type) => type.rest_base === "posts")) {
    postTypes.push({ slug: "post", name: "Posts", rest_base: "posts", taxonomies: ["category", "post_tag"] });
  }
  if (!postTypes.some((type) => type.rest_base === "pages")) {
    postTypes.push({ slug: "page", name: "Pages", rest_base: "pages", taxonomies: [] });
  }

  const content = [];
  for (const type of postTypes) {
    try {
      const result = await fetchCollection(site, authHeaders, `/wp-json/wp/v2/${type.rest_base}`, {
        context: "edit",
        status: "any"
      }, { fetchImpl, timeoutMs: 60000 });
      warnings.push(...result.warnings);
      content.push({
        type: type.slug,
        rest_base: type.rest_base,
        count: result.items.length,
        items: result.items
      });
    } catch (error) {
      warnings.push(`${type.rest_base}: ${error.message}`);
    }
  }

  const terms = [];
  for (const [slug, definition] of Object.entries(taxonomiesPayload)) {
    const restBase = normalizeRestBase(definition.rest_base || slug);
    if (!restBase) continue;
    try {
      const result = await fetchCollection(site, authHeaders, `/wp-json/wp/v2/${restBase}`, {
        context: "edit",
        hide_empty: "false"
      }, { fetchImpl, timeoutMs: 45000 });
      warnings.push(...result.warnings);
      terms.push({
        taxonomy: slug,
        rest_base: restBase,
        count: result.items.length,
        items: result.items
      });
    } catch (error) {
      warnings.push(`${restBase}: ${error.message}`);
    }
  }

  let media = null;
  if (settings.includeMediaCatalog) {
    try {
      const result = await fetchCollection(site, authHeaders, "/wp-json/wp/v2/media", {
        context: "edit"
      }, { fetchImpl, timeoutMs: 60000 });
      warnings.push(...result.warnings);
      media = {
        count: result.items.length,
        items: result.items.map((item) => ({
          id: item.id,
          date: item.date,
          modified: item.modified,
          slug: item.slug,
          status: item.status,
          title: item.title,
          alt_text: item.alt_text,
          caption: item.caption,
          description: item.description,
          media_type: item.media_type,
          mime_type: item.mime_type,
          source_url: item.source_url,
          media_details: item.media_details
        }))
      };
    } catch (error) {
      warnings.push(`media: ${error.message}`);
    }
  }

  const [menus, menuItems] = await Promise.all([
    tryFetch(site, authHeaders, "/wp-json/wp/v2/menus?context=edit&per_page=100", { fetchImpl, warnings, timeoutMs: 30000 }),
    tryFetch(site, authHeaders, "/wp-json/wp/v2/menu-items?context=edit&per_page=100", { fetchImpl, warnings, timeoutMs: 30000 })
  ]);

  return {
    source: "wordpress-rest-fallback",
    generatedAt,
    site: {
      name: site.name,
      siteUrl: site.siteUrl || site.url,
      endpointUrl: site.endpointUrl,
      namespace: index?.namespaces || []
    },
    settings: settingsPayload,
    postTypes,
    taxonomies: Object.values(taxonomiesPayload).map((taxonomy) => ({
      name: taxonomy.name,
      slug: taxonomy.slug,
      rest_base: taxonomy.rest_base,
      hierarchical: taxonomy.hierarchical,
      types: taxonomy.types
    })),
    content,
    terms,
    menus: Array.isArray(menus) ? menus : [],
    menuItems: Array.isArray(menuItems) ? menuItems : [],
    media,
    warnings
  };
}

async function companionSnapshot(site, authHeaders, settings, fetchImpl) {
  const result = await fetchWpJson(site, authHeaders, "/wp-json/wp-mcp-connector/v1/backup-export", {
    method: "POST",
    body: {
      include_media_catalog: settings.includeMediaCatalog
    },
    timeoutMs: 120000,
    fetchImpl
  });
  return result.payload;
}

export async function createWordPressBackup({ rootDir, site, authHeaders, reason = "manual", trigger = "manual", settings, fetchImpl = fetch }) {
  const normalized = normalizeBackupSettings(settings);
  const startedAt = Date.now();
  const backupId = randomUUID();
  const createdAt = new Date().toISOString();
  const dir = backupDir(rootDir, site);
  await mkdir(dir, { recursive: true });

  let snapshot;
  let source = "companion";
  const warnings = [];
  try {
    snapshot = await companionSnapshot(site, authHeaders, normalized, fetchImpl);
  } catch (error) {
    source = "wordpress-rest-fallback";
    warnings.push(`companion export unavailable: ${error.message}`);
    snapshot = await fallbackRestSnapshot(site, authHeaders, normalized, fetchImpl);
  }

  const manifest = {
    id: backupId,
    createdAt,
    durationMs: Date.now() - startedAt,
    reason,
    trigger,
    source: snapshot.source || source,
    strategy: normalized.strategy,
    includeMediaCatalog: normalized.includeMediaCatalog,
    site: {
      id: site.id,
      name: site.name,
      siteUrl: site.siteUrl || site.url,
      serverName: site.serverName || null
    },
    warnings: [...warnings, ...(Array.isArray(snapshot.warnings) ? snapshot.warnings : [])]
  };

  const body = {
    manifest,
    snapshot
  };
  const filename = `${createdAt.replace(/[:.]/g, "-")}-${trigger}.json`;
  const filePath = path.join(dir, filename);
  await writeFile(filePath, JSON.stringify(body, null, 2), { mode: 0o600 });
  const stats = await stat(filePath);
  await applyBackupRetention(rootDir, site, normalized.retention);

  return {
    ...manifest,
    filename,
    filePath,
    sizeBytes: stats.size
  };
}

export async function listBackupRecords(rootDir, site, limit = 20) {
  const dir = backupDir(rootDir, site);
  let files;
  try {
    files = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const records = [];
  for (const filename of files.filter((file) => file.endsWith(".json"))) {
    const filePath = path.join(dir, filename);
    try {
      const [stats, raw] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
      const parsed = JSON.parse(raw);
      records.push({
        ...(parsed.manifest || {}),
        filename,
        filePath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString()
      });
    } catch {
      // Ignore partial or manually edited files.
    }
  }

  records.sort((a, b) => String(b.createdAt || b.modifiedAt).localeCompare(String(a.createdAt || a.modifiedAt)));
  return records.slice(0, limit);
}

export async function applyBackupRetention(rootDir, site, retention) {
  const keep = Number(retention);
  if (!Number.isFinite(keep) || keep <= 0) return;
  const records = await listBackupRecords(rootDir, site, Number.MAX_SAFE_INTEGER);
  for (const record of records.slice(keep)) {
    await unlink(record.filePath).catch(() => {});
  }
}

export function backupSettingsAfterResult(settings, record, trigger) {
  const normalized = normalizeBackupSettings(settings);
  const now = record.createdAt || new Date().toISOString();
  return {
    ...normalized,
    lastRunAt: now,
    lastManualRunAt: trigger === "manual" ? now : normalized.lastManualRunAt,
    lastPreChangeAt: trigger === "pre-change" ? now : normalized.lastPreChangeAt,
    lastStatus: {
      ok: true,
      checkedAt: now,
      message: "备份完成",
      trigger,
      source: record.source,
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      warnings: record.warnings || []
    },
    updatedAt: now
  };
}

export function backupSettingsAfterError(settings, error, trigger) {
  const normalized = normalizeBackupSettings(settings);
  const now = new Date().toISOString();
  return {
    ...normalized,
    lastStatus: {
      ok: false,
      checkedAt: now,
      message: error.message || "备份失败",
      trigger
    },
    updatedAt: now
  };
}

export async function updateStoredBackupStatus(rootDir, siteId, updater) {
  const dataFile = path.join(rootDir, "data", "sites.json");
  const store = JSON.parse(await readFile(dataFile, "utf8"));
  const site = store.sites.find((item) => item.id === siteId);
  if (!site) throw new Error(`WordPress MCP site not found: ${siteId}`);
  const current = normalizeBackupSettings(site.backup);
  site.backup = normalizeBackupSettings(updater(current, site) || current);
  site.updatedAt = new Date().toISOString();
  const tmpFile = `${dataFile}.${Date.now()}.tmp`;
  await writeFile(tmpFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(tmpFile, dataFile);
  return site.backup;
}
