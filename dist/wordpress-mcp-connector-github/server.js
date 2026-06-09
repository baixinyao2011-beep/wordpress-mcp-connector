import { createServer } from "node:http";
import { randomUUID, randomBytes, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile, chmod } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backupDue,
  backupSettingsAfterError,
  backupSettingsAfterResult,
  backupStrategiesForClient,
  createWordPressBackup,
  listBackupRecords,
  normalizeBackupSettings
} from "./lib/backup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "sites.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const RUNTIME_FILE = path.join(DATA_DIR, "runtime.json");
const KEY_FILE = path.join(__dirname, ".wp-connector-key");
const RUNNER_FILE = path.join(__dirname, "bin", "run-wordpress-mcp.js");
const HOST = process.env.HOST || "127.0.0.1";
const PORT_MIN = 49152;
const PORT_MAX = 65535;
const DEFAULT_MCP_PATH = "/wp-json/mcp/mcp-adapter-default-server";
const COMPANION_PLUGIN_URL = "https://github.com/baixinyao2011-beep/wordpress-mcp-connector/tree/main/wordpress-plugin/wordpress-mcp-connector-companion";
const sessions = new Map();

const PERMISSION_DEFINITIONS = [
  { key: "contentWrite", label: "文章与页面写入", defaultEnabled: true },
  { key: "mediaUpload", label: "媒体上传", defaultEnabled: true },
  { key: "taxonomyWrite", label: "分类与板块", defaultEnabled: true },
  { key: "seoGeo", label: "SEO 与 GEO", defaultEnabled: true },
  { key: "backupManage", label: "备份与恢复点", defaultEnabled: true },
  { key: "cacheManage", label: "LiteSpeed 清缓存", defaultEnabled: false },
  { key: "menuWrite", label: "菜单管理", defaultEnabled: false },
  { key: "settingsManage", label: "站点设置", defaultEnabled: false },
  { key: "codeSnippets", label: "代码片段", defaultEnabled: false },
  { key: "usersManage", label: "用户管理", defaultEnabled: false },
  { key: "pluginThemeManage", label: "插件与主题管理", defaultEnabled: false },
  { key: "packageInstall", label: "本地 zip 安装", defaultEnabled: false },
  { key: "destructiveDelete", label: "删除操作", defaultEnabled: false }
];

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function randomPort() {
  return PORT_MIN + randomBytes(2).readUInt16BE(0) % (PORT_MAX - PORT_MIN + 1);
}

async function ensureRuntimeConfig() {
  await mkdir(DATA_DIR, { recursive: true });
  if (process.env.PORT) {
    return { port: Number(process.env.PORT), generated: false };
  }

  try {
    const existing = JSON.parse(await readFile(RUNTIME_FILE, "utf8"));
    if (Number.isInteger(existing.port) && existing.port >= PORT_MIN && existing.port <= PORT_MAX) {
      return { ...existing, generated: false };
    }
  } catch {
    // Create below.
  }

  const runtime = {
    port: randomPort(),
    createdAt: new Date().toISOString()
  };
  await writeFile(RUNTIME_FILE, JSON.stringify(runtime, null, 2), { mode: 0o600 });
  return { ...runtime, generated: true };
}

async function saveRuntimePort(port) {
  const runtime = {
    port,
    updatedAt: new Date().toISOString()
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(RUNTIME_FILE, JSON.stringify(runtime, null, 2), { mode: 0o600 });
}

const runtimeConfig = await ensureRuntimeConfig();
let PORT = Number(runtimeConfig.port);

async function ensureKey() {
  try {
    const existing = await readFile(KEY_FILE, "utf8");
    const key = Buffer.from(existing.trim(), "base64");
    if (key.length === 32) return key;
  } catch {
    // Create below.
  }

  const key = randomBytes(32);
  await writeFile(KEY_FILE, key.toString("base64"), { mode: 0o600 });
  try {
    await chmod(KEY_FILE, 0o600);
  } catch {
    // Some filesystems ignore chmod.
  }
  return key;
}

const encryptionKey = await ensureKey();

function encryptText(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptText(value) {
  const [ivText, tagText, encryptedText] = String(value || "").split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Encrypted value is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final()
  ]).toString("utf8");
}

async function loadStore() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { sites: Array.isArray(parsed.sites) ? parsed.sites : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { sites: [] };
    throw error;
  }
}

async function saveStore(store) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${DATA_FILE}.${Date.now()}.tmp`;
  await writeFile(tmpFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(tmpFile, DATA_FILE);
}

async function loadUsers() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { users: Array.isArray(parsed.users) ? parsed.users : [] };
  } catch (error) {
    if (error.code === "ENOENT") return { users: [] };
    throw error;
  }
}

async function saveUsers(store) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${USERS_FILE}.${Date.now()}.tmp`;
  await writeFile(tmpFile, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(tmpFile, USERS_FILE);
}

function hashPassword(password, salt = randomBytes(16).toString("base64")) {
  const hash = scryptSync(String(password), salt, 64).toString("base64");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = Buffer.from(hashPassword(password, salt).split("$")[2], "base64");
  const expected = Buffer.from(hash, "base64");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role || "admin",
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null
  };
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((pair) => {
    const index = pair.indexOf("=");
    if (index === -1) return ["", ""];
    return [pair.slice(0, index).trim(), decodeURIComponent(pair.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sessionHash(token) {
  return createHash("sha256").update(token).digest("base64url");
}

function setSessionCookie(res, token) {
  res.setHeader("set-cookie", `wp_mcp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
}

function clearSessionCookie(res) {
  res.setHeader("set-cookie", "wp_mcp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
}

async function currentUser(req) {
  const token = parseCookies(req).wp_mcp_session;
  if (!token) return null;
  const session = sessions.get(sessionHash(token));
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(sessionHash(token));
    return null;
  }
  const store = await loadUsers();
  return store.users.find((user) => user.id === session.userId) || null;
}

async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw httpError(401, "请先登录。");
  return user;
}

function createSession(res, user) {
  const token = randomBytes(32).toString("base64url");
  sessions.set(sessionHash(token), {
    userId: user.id,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000
  });
  setSessionCookie(res, token);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeUrl(input, fieldName) {
  const raw = String(input || "").trim();
  if (!raw) throw httpError(400, `请填写${fieldName}。`);

  let url;
  try {
    url = new URL(raw.match(/^https?:\/\//i) ? raw : `https://${raw}`);
  } catch {
    throw httpError(400, `${fieldName}格式不正确。`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw httpError(400, `${fieldName}必须是 http 或 https。`);
  }

  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function defaultEndpoint(siteUrl) {
  return `${siteUrl}${DEFAULT_MCP_PATH}`;
}

function validateAuthMode(value) {
  const allowed = new Set(["oauth", "application-password", "jwt", "custom-headers"]);
  return allowed.has(value) ? value : "oauth";
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

function secretPresence(site) {
  return {
    password: Boolean(site.passwordEncrypted),
    jwt: Boolean(site.jwtEncrypted),
    customHeaders: Boolean(site.customHeadersEncrypted),
    wooSecret: Boolean(site.wooSecretEncrypted)
  };
}

function sanitizeSite(site) {
  return {
    id: site.id,
    name: site.name,
    siteUrl: site.siteUrl || site.url,
    endpointUrl: site.endpointUrl || defaultEndpoint(site.siteUrl || site.url),
    adminUrl: `${site.siteUrl || site.url}/wp-admin/`,
    authMode: site.authMode || site.authType || "oauth",
    username: site.username || "",
    wooKey: site.wooKey || "",
    serverName: site.serverName || serverNameFromSite(site),
    notes: site.notes || "",
    permissions: normalizePermissions(site.permissions),
    backup: normalizeBackupSettings(site.backup),
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
    hasSecret: secretPresence(site),
    lastStatus: site.lastStatus || null
  };
}

function serverNameFromSite(site) {
  const source = site.siteUrl || site.url || site.name || "wordpress";
  try {
    const host = new URL(source).hostname;
    return `wordpress-${host.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
  } catch {
    return `wordpress-${String(site.name || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site"}`;
  }
}

function applySitePayload(site, payload, { requireSecrets }) {
  const siteUrl = normalizeUrl(payload.siteUrl || payload.url, "网站地址");
  const endpointUrl = normalizeUrl(payload.endpointUrl || defaultEndpoint(siteUrl), "MCP Endpoint");
  const authMode = validateAuthMode(payload.authMode || payload.authType);
  const username = cleanText(payload.username, 160);
  const password = String(payload.password ?? payload.secret ?? "");
  const jwt = String(payload.jwt ?? "");
  const customHeaders = String(payload.customHeaders ?? "").trim();
  const wooKey = cleanText(payload.wooKey, 220);
  const wooSecret = String(payload.wooSecret ?? "");

  if (authMode === "application-password" && !username) {
    throw httpError(400, "应用密码方式需要填写用户名。");
  }
  if (requireSecrets && authMode === "application-password" && !password) {
    throw httpError(400, "请填写 WordPress 应用密码。");
  }
  if (requireSecrets && authMode === "jwt" && !jwt) {
    throw httpError(400, "请填写 JWT Token。");
  }
  if (requireSecrets && authMode === "custom-headers" && !customHeaders) {
    throw httpError(400, "请填写自定义 headers。");
  }
  if (wooKey && requireSecrets && !wooSecret) {
    throw httpError(400, "填写 WooCommerce Key 时也需要填写 Secret。");
  }

  site.name = cleanText(payload.name, 120) || "未命名站点";
  site.siteUrl = siteUrl;
  site.endpointUrl = endpointUrl;
  site.authMode = authMode;
  site.username = username;
  site.wooKey = wooKey;
  site.serverName = cleanText(payload.serverName, 90) || serverNameFromSite({ siteUrl, name: payload.name });
  site.notes = cleanText(payload.notes, 1000);
  site.permissions = normalizePermissions(payload.permissions ?? site.permissions);
  site.backup = normalizeBackupSettings(payload.backup ?? site.backup);
  site.updatedAt = new Date().toISOString();

  if (password) site.passwordEncrypted = encryptText(password);
  if (jwt) site.jwtEncrypted = encryptText(jwt);
  if (customHeaders) site.customHeadersEncrypted = encryptText(customHeaders);
  if (wooSecret) site.wooSecretEncrypted = encryptText(wooSecret);

  delete site.url;
  delete site.authType;
  delete site.secretEncrypted;
}

async function parseJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) throw httpError(413, "请求内容过大。");
  }

  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw httpError(400, "请求 JSON 格式不正确。");
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendError(res, error) {
  sendJson(res, error.status || 500, {
    error: error.status ? error.message : "服务器处理失败。"
  });
}

function validateRequestOrigin(req) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method || "GET")) return;
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    const url = new URL(origin);
    if (url.hostname === HOST && Number(url.port || 80) === PORT) return;
  } catch {
    // Reject below.
  }
  throw httpError(403, "请求来源不被允许。");
}

function parseHeadersText(value) {
  const raw = String(value || "").trim();
  if (!raw) return {};

  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("CUSTOM_HEADERS JSON 必须是对象。");
    }
    return Object.fromEntries(Object.entries(parsed).map(([key, val]) => [key, String(val)]));
  }

  return Object.fromEntries(raw.split(",").map((pair) => {
    const index = pair.indexOf(":");
    if (index === -1) throw new Error("CUSTOM_HEADERS 需要使用 Header-Name: value 格式。");
    return [pair.slice(0, index).trim(), pair.slice(index + 1).trim()];
  }).filter(([key]) => key));
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

  throw new Error("当前授权方式不支持同步 companion 权限。");
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

async function fetchWpJson(site, apiPath, options = {}) {
  const env = buildRuntimeEnv(site, { includeSecrets: true });
  const response = await fetch(`${String(site.siteUrl || site.url).replace(/\/$/, "")}${apiPath}`, {
    method: options.method || "GET",
    headers: {
      ...authHeadersForSite(site, env),
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || 15000)
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const error = new Error(payload.message || `WordPress REST 返回 HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

async function syncCompanionPermissions(site) {
  const permissions = normalizePermissions(site.permissions);
  return fetchWpJson(site, "/wp-json/wp-mcp-connector/v1/permissions", {
    method: "POST",
    body: {
      package_installs: permissions.packageInstall,
      llms_text: permissions.seoGeo,
      backup_exports: permissions.backupManage,
      litespeed_cache: permissions.cacheManage
    }
  });
}

async function trySyncCompanionPermissions(site) {
  try {
    return {
      ok: true,
      result: await syncCompanionPermissions(site)
    };
  } catch (error) {
    const isMissingRoute = error.statusCode === 404 || /No route was found/i.test(error.message);
    return {
      ok: false,
      missingCompanion: isMissingRoute,
      companionPluginUrl: COMPANION_PLUGIN_URL,
      message: isMissingRoute
        ? `功能开启失败：该功能需要先在 WordPress 后台正常安装并启用 companion plugin。本地权限已保存，但 llms.txt 和本地 zip 安装不会同步到 WordPress 端。下载地址：${COMPANION_PLUGIN_URL}`
        : error.message
    };
  }
}

function buildRuntimeEnv(site, { includeSecrets }) {
  const env = {
    WP_API_URL: site.endpointUrl,
    OAUTH_ENABLED: site.authMode === "oauth" ? "true" : "false"
  };

  if (site.authMode === "application-password") {
    env.WP_API_USERNAME = site.username;
    if (includeSecrets && site.passwordEncrypted) {
      env.WP_API_PASSWORD = decryptText(site.passwordEncrypted);
    }
  }

  if (site.authMode === "jwt" && includeSecrets && site.jwtEncrypted) {
    env.JWT_TOKEN = decryptText(site.jwtEncrypted);
  }

  if (site.authMode === "custom-headers" && includeSecrets && site.customHeadersEncrypted) {
    env.CUSTOM_HEADERS = decryptText(site.customHeadersEncrypted);
  }

  if (site.wooKey) env.WOO_CUSTOMER_KEY = site.wooKey;
  if (includeSecrets && site.wooSecretEncrypted) {
    env.WOO_CUSTOMER_SECRET = decryptText(site.wooSecretEncrypted);
  }

  return env;
}

function buildClientConfig(site) {
  return {
    mcpServers: {
      [site.serverName || serverNameFromSite(site)]: {
        command: "node",
        args: [RUNNER_FILE, site.id]
      }
    }
  };
}

async function testMcpEndpoint(site) {
  const startedAt = Date.now();
  const headers = {
    Accept: "application/json, text/event-stream",
    "User-Agent": "Local WordPress MCP Connector"
  };
  const env = buildRuntimeEnv(site, { includeSecrets: true });

  if (site.authMode === "application-password" && env.WP_API_USERNAME && env.WP_API_PASSWORD) {
    headers.Authorization = `Basic ${Buffer.from(`${env.WP_API_USERNAME}:${env.WP_API_PASSWORD}`, "utf8").toString("base64")}`;
  }
  if (site.authMode === "jwt" && env.JWT_TOKEN) {
    headers.Authorization = `Bearer ${env.JWT_TOKEN}`;
  }
  if (site.authMode === "custom-headers" && env.CUSTOM_HEADERS) {
    Object.assign(headers, parseHeadersText(env.CUSTOM_HEADERS));
  }

  const response = await fetch(site.endpointUrl, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15000)
  });

  const okStatuses = new Set([200, 400, 401, 405]);
  const ok = okStatuses.has(response.status) && !(response.status === 401 && site.authMode !== "oauth");
  const message = ok
    ? response.status === 401
      ? "Endpoint 可访问，等待 OAuth 授权"
      : "MCP Endpoint 可访问"
    : `MCP Endpoint 返回 HTTP ${response.status}`;

  return {
    ok,
    statusCode: response.status,
    message,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt
  };
}

async function runBackupForSite(site, { reason = "manual", trigger = "manual" } = {}) {
  const env = buildRuntimeEnv(site, { includeSecrets: true });
  return createWordPressBackup({
    rootDir: __dirname,
    site,
    authHeaders: authHeadersForSite(site, env),
    reason,
    trigger,
    settings: site.backup
  });
}

const scheduledBackupRuns = new Set();

async function runScheduledBackups() {
  const store = await loadStore();
  let changed = false;

  for (const site of store.sites) {
    const settings = normalizeBackupSettings(site.backup);
    if (!backupDue(settings) || scheduledBackupRuns.has(site.id)) continue;

    scheduledBackupRuns.add(site.id);
    try {
      const record = await runBackupForSite(site, {
        reason: "scheduled",
        trigger: "scheduled"
      });
      site.backup = backupSettingsAfterResult(settings, record, "scheduled");
    } catch (error) {
      site.backup = backupSettingsAfterError(settings, error, "scheduled");
    } finally {
      scheduledBackupRuns.delete(site.id);
      site.updatedAt = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) await saveStore(store);
}

async function apiHandler(req, res, pathname) {
  if (pathname.startsWith("/api/auth/")) {
    const usersStore = await loadUsers();
    const setupRequired = usersStore.users.length === 0;

    if (req.method === "GET" && pathname === "/api/auth/status") {
      const user = await currentUser(req);
      return sendJson(res, 200, {
        authenticated: Boolean(user),
        setupRequired,
        user: user ? sanitizeUser(user) : null,
        dashboardUrl: `http://${HOST}:${PORT}`
      });
    }

    if (req.method === "POST" && pathname === "/api/auth/setup") {
      if (!setupRequired) throw httpError(403, "管理员已创建，请登录。");
      const payload = await parseJson(req);
      const username = cleanText(payload.username, 80);
      const password = String(payload.password || "");
      if (!username) throw httpError(400, "请填写用户名。");
      if (password.length < 6) throw httpError(400, "密码至少需要 6 位。");
      const now = new Date().toISOString();
      const user = {
        id: randomUUID(),
        username,
        passwordHash: hashPassword(password),
        role: "admin",
        createdAt: now,
        lastLoginAt: now
      };
      usersStore.users.push(user);
      await saveUsers(usersStore);
      createSession(res, user);
      return sendJson(res, 201, { user: sanitizeUser(user), setupRequired: false });
    }

    if (req.method === "POST" && pathname === "/api/auth/login") {
      const payload = await parseJson(req);
      const username = cleanText(payload.username, 80);
      const password = String(payload.password || "");
      const user = usersStore.users.find((item) => item.username === username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        throw httpError(401, "用户名或密码不正确。");
      }
      user.lastLoginAt = new Date().toISOString();
      await saveUsers(usersStore);
      createSession(res, user);
      return sendJson(res, 200, { user: sanitizeUser(user), setupRequired: false });
    }

    if (req.method === "POST" && pathname === "/api/auth/logout") {
      const token = parseCookies(req).wp_mcp_session;
      if (token) sessions.delete(sessionHash(token));
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }
  }

  const authUser = await requireUser(req);

  if (pathname.startsWith("/api/users")) {
    const usersStore = await loadUsers();
    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);

    if (req.method === "GET" && pathname === "/api/users") {
      return sendJson(res, 200, { users: usersStore.users.map(sanitizeUser), currentUser: sanitizeUser(authUser) });
    }

    if (req.method === "POST" && pathname === "/api/users") {
      const payload = await parseJson(req);
      const username = cleanText(payload.username, 80);
      const password = String(payload.password || "");
      if (!username) throw httpError(400, "请填写用户名。");
      if (password.length < 6) throw httpError(400, "密码至少需要 6 位。");
      if (usersStore.users.some((user) => user.username === username)) {
        throw httpError(409, "这个用户名已存在。");
      }
      const user = {
        id: randomUUID(),
        username,
        passwordHash: hashPassword(password),
        role: "admin",
        createdAt: new Date().toISOString()
      };
      usersStore.users.push(user);
      await saveUsers(usersStore);
      return sendJson(res, 201, { user: sanitizeUser(user), users: usersStore.users.map(sanitizeUser) });
    }

    if (req.method === "DELETE" && userMatch) {
      const id = userMatch[1];
      if (id === authUser.id) throw httpError(400, "不能删除当前登录用户。");
      if (usersStore.users.length <= 1) throw httpError(400, "至少需要保留一个管理员。");
      const index = usersStore.users.findIndex((user) => user.id === id);
      if (index === -1) throw httpError(404, "没有找到这个用户。");
      usersStore.users.splice(index, 1);
      await saveUsers(usersStore);
      return sendJson(res, 200, { deleted: true, users: usersStore.users.map(sanitizeUser) });
    }
  }

  const store = await loadStore();
  const siteMatch = pathname.match(/^\/api\/sites\/([^/]+)(?:\/([^/]+))?$/);

  if (req.method === "GET" && pathname === "/api/sites") {
    return sendJson(res, 200, {
      sites: store.sites.map(sanitizeSite),
      permissionDefinitions: PERMISSION_DEFINITIONS,
      backupStrategies: backupStrategiesForClient()
    });
  }

  if (req.method === "POST" && pathname === "/api/sites") {
    const payload = await parseJson(req);
    const now = new Date().toISOString();
    const site = { id: randomUUID(), createdAt: now, updatedAt: now };
    applySitePayload(site, payload, { requireSecrets: false });
    store.sites.unshift(site);
    const companionSync = await trySyncCompanionPermissions(site);
    await saveStore(store);
    return sendJson(res, 201, { site: sanitizeSite(site), companionSync });
  }

  if (!siteMatch) throw httpError(404, "没有找到这个接口。");

  const [, id, action] = siteMatch;
  const index = store.sites.findIndex((site) => site.id === id);
  if (index === -1) throw httpError(404, "没有找到这个站点。");
  const site = store.sites[index];

  if (req.method === "PUT" && !action) {
    const payload = await parseJson(req);
    applySitePayload(site, payload, { requireSecrets: false });
    const companionSync = await trySyncCompanionPermissions(site);
    await saveStore(store);
    return sendJson(res, 200, { site: sanitizeSite(site), companionSync });
  }

  if (req.method === "PUT" && action === "permissions") {
    const payload = await parseJson(req);
    site.permissions = normalizePermissions(payload.permissions);
    site.updatedAt = new Date().toISOString();

    let companionSync = null;
    if (payload.syncCompanion !== false) {
      companionSync = await trySyncCompanionPermissions(site);
    }

    await saveStore(store);
    return sendJson(res, 200, {
      site: sanitizeSite(site),
      permissionDefinitions: PERMISSION_DEFINITIONS,
      companionSync
    });
  }

  if (req.method === "GET" && action === "backups") {
    const records = await listBackupRecords(__dirname, site);
    return sendJson(res, 200, {
      backups: records,
      backup: normalizeBackupSettings(site.backup)
    });
  }

  if (req.method === "PUT" && action === "backup") {
    const payload = await parseJson(req);
    site.backup = normalizeBackupSettings(payload.backup ?? payload);
    site.updatedAt = new Date().toISOString();
    await saveStore(store);
    return sendJson(res, 200, {
      site: sanitizeSite(site),
      backup: normalizeBackupSettings(site.backup),
      backupStrategies: backupStrategiesForClient()
    });
  }

  if (req.method === "POST" && action === "backup") {
    let record;
    try {
      record = await runBackupForSite(site, {
        reason: "dashboard manual backup",
        trigger: "manual"
      });
      site.backup = backupSettingsAfterResult(site.backup, record, "manual");
    } catch (error) {
      site.backup = backupSettingsAfterError(site.backup, error, "manual");
      site.updatedAt = new Date().toISOString();
      await saveStore(store);
      throw error;
    }

    site.updatedAt = new Date().toISOString();
    await saveStore(store);
    return sendJson(res, 200, {
      backup: normalizeBackupSettings(site.backup),
      record,
      backups: await listBackupRecords(__dirname, site)
    });
  }

  if (req.method === "DELETE" && !action) {
    store.sites.splice(index, 1);
    await saveStore(store);
    return sendJson(res, 200, { deleted: true });
  }

  if (req.method === "POST" && action === "test") {
    const result = await testMcpEndpoint(site);
    site.lastStatus = result;
    site.updatedAt = new Date().toISOString();
    await saveStore(store);
    return sendJson(res, 200, { result, site: sanitizeSite(site) });
  }

  if (req.method === "GET" && action === "config") {
    return sendJson(res, 200, {
      config: buildClientConfig(site),
      envPreview: buildRuntimeEnv(site, { includeSecrets: false }),
      runner: RUNNER_FILE
    });
  }

  throw httpError(404, "没有找到这个接口。");
}

async function staticHandler(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!resolved.startsWith(PUBLIC_DIR)) throw httpError(403, "禁止访问。");

  try {
    const stats = await stat(resolved);
    if (!stats.isFile()) throw httpError(404, "文件不存在。");
    const ext = path.extname(resolved);
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
      "content-length": stats.size,
      "cache-control": "no-cache"
    });
    createReadStream(resolved).pipe(res);
  } catch (error) {
    if (error.status) throw error;
    if (error.code === "ENOENT") throw httpError(404, "文件不存在。");
    throw error;
  }
}

const server = createServer(async (req, res) => {
  try {
    validateRequestOrigin(req);
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

    if (url.pathname.startsWith("/api/")) {
      await apiHandler(req, res, url.pathname);
      return;
    }

    await staticHandler(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    sendError(res, error);
  }
});

server.on("error", async (error) => {
  if (error.code === "EADDRINUSE" && !process.env.PORT) {
    PORT = randomPort();
    await saveRuntimePort(PORT);
    server.listen(PORT, HOST);
    return;
  }
  console.error(error);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  await saveRuntimePort(PORT);
  console.log(`WordPress MCP connector is running at http://${HOST}:${PORT}`);
  setTimeout(() => runScheduledBackups().catch((error) => console.error("Scheduled backup failed:", error)), 10000);
  setInterval(() => runScheduledBackups().catch((error) => console.error("Scheduled backup failed:", error)), 5 * 60 * 1000);
});
