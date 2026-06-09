const DEFAULT_MCP_PATH = "/wp-json/mcp/mcp-adapter-default-server";

const state = {
  sites: [],
  users: [],
  currentUser: null,
  setupRequired: false,
  authenticated: false,
  permissionDefinitions: [],
  backupStrategies: [],
  backupRecords: [],
  selectedId: null,
  search: "",
  busy: false,
  backupBusy: false,
  config: null
};

const els = {
  authShell: document.querySelector("#authShell"),
  appShell: document.querySelector("#appShell"),
  authForm: document.querySelector("#authForm"),
  authModeLabel: document.querySelector("#authModeLabel"),
  authTitle: document.querySelector("#authTitle"),
  authCopy: document.querySelector("#authCopy"),
  authSubmitButton: document.querySelector("#authSubmitButton"),
  loginUsernameInput: document.querySelector("#loginUsernameInput"),
  loginPasswordInput: document.querySelector("#loginPasswordInput"),
  siteList: document.querySelector("#siteList"),
  searchInput: document.querySelector("#searchInput"),
  newSiteButton: document.querySelector("#newSiteButton"),
  refreshButton: document.querySelector("#refreshButton"),
  form: document.querySelector("#siteForm"),
  nameInput: document.querySelector("#nameInput"),
  serverNameInput: document.querySelector("#serverNameInput"),
  siteUrlInput: document.querySelector("#siteUrlInput"),
  endpointUrlInput: document.querySelector("#endpointUrlInput"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  jwtInput: document.querySelector("#jwtInput"),
  customHeadersInput: document.querySelector("#customHeadersInput"),
  wooKeyInput: document.querySelector("#wooKeyInput"),
  wooSecretInput: document.querySelector("#wooSecretInput"),
  notesInput: document.querySelector("#notesInput"),
  backupStrategySelect: document.querySelector("#backupStrategySelect"),
  backupRetentionInput: document.querySelector("#backupRetentionInput"),
  beforeWriteBackupInput: document.querySelector("#beforeWriteBackupInput"),
  includeMediaCatalogInput: document.querySelector("#includeMediaCatalogInput"),
  runBackupButton: document.querySelector("#runBackupButton"),
  backupStrategyHint: document.querySelector("#backupStrategyHint"),
  permissionGrid: document.querySelector("#permissionGrid"),
  deleteButton: document.querySelector("#deleteButton"),
  resetButton: document.querySelector("#resetButton"),
  testButton: document.querySelector("#testButton"),
  configButton: document.querySelector("#configButton"),
  logoutButton: document.querySelector("#logoutButton"),
  adminLink: document.querySelector("#adminLink"),
  modeLabel: document.querySelector("#modeLabel"),
  pageTitle: document.querySelector("#pageTitle"),
  statusStrip: document.querySelector("#statusStrip"),
  statusText: document.querySelector("#statusText"),
  statusMeta: document.querySelector("#statusMeta"),
  lastChecked: document.querySelector("#lastChecked"),
  latency: document.querySelector("#latency"),
  authSummary: document.querySelector("#authSummary"),
  backupStrategyStatus: document.querySelector("#backupStrategyStatus"),
  lastBackupStatus: document.querySelector("#lastBackupStatus"),
  backupList: document.querySelector("#backupList"),
  configPreview: document.querySelector("#configPreview"),
  userList: document.querySelector("#userList"),
  userForm: document.querySelector("#userForm"),
  newUsernameInput: document.querySelector("#newUsernameInput"),
  newPasswordInput: document.querySelector("#newPasswordInput"),
  toast: document.querySelector("#toast")
};

function selectedSite() {
  return state.sites.find((site) => site.id === state.selectedId) || null;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function formatDate(value) {
  if (!value) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "暂无";
  if (number < 1024 * 1024) return `${Math.round(number / 1024)} KB`;
  return `${(number / 1024 / 1024).toFixed(1)} MB`;
}

function authModeLabel(value) {
  return {
    oauth: "OAuth",
    "application-password": "应用密码",
    jwt: "JWT",
    "custom-headers": "Headers"
  }[value] || value;
}

function defaultEndpoint(siteUrl) {
  const raw = siteUrl.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.match(/^https?:\/\//i) ? raw : `https://${raw}`);
    url.hash = "";
    url.search = "";
    return `${url.toString().replace(/\/$/, "")}${DEFAULT_MCP_PATH}`;
  } catch {
    return "";
  }
}

function setBusy(value) {
  state.busy = value;
  els.form.querySelectorAll("button, input, textarea, select").forEach((element) => {
    element.disabled = value;
  });
  els.testButton.disabled = value || !state.selectedId;
  els.configButton.disabled = value || !state.selectedId;
  els.runBackupButton.disabled = value || state.backupBusy || !state.selectedId;
  els.refreshButton.disabled = value;
  els.newSiteButton.disabled = value;
}

function setBackupBusy(value) {
  state.backupBusy = value;
  els.runBackupButton.disabled = value || state.busy || !state.selectedId;
  els.runBackupButton.textContent = value ? "备份中" : "立即备份";
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    state.authenticated = false;
    showAuth();
  }
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function showAuth() {
  els.appShell.classList.add("hidden");
  els.authShell.classList.remove("hidden");
  els.authModeLabel.textContent = state.setupRequired ? "首次设置" : "本地登录";
  els.authTitle.textContent = state.setupRequired ? "创建本地管理员" : "WordPress MCP 连接器";
  els.authCopy.textContent = state.setupRequired
    ? "首次使用需要创建一个本地管理员。这个账号只保护本机管理页面，不会发送到 WordPress。"
    : "登录后才能管理站点授权、权限开关和 MCP 配置。";
  els.authSubmitButton.textContent = state.setupRequired ? "创建并登录" : "登录";
}

function showApp() {
  els.authShell.classList.add("hidden");
  els.appShell.classList.remove("hidden");
}

async function loadAuthStatus() {
  const data = await request("/api/auth/status");
  state.authenticated = data.authenticated;
  state.setupRequired = data.setupRequired;
  state.currentUser = data.user || null;
  if (!state.authenticated) {
    showAuth();
    return false;
  }
  showApp();
  return true;
}

async function submitAuth(event) {
  event.preventDefault();
  const path = state.setupRequired ? "/api/auth/setup" : "/api/auth/login";
  try {
    const data = await request(path, {
      method: "POST",
      body: JSON.stringify({
        username: els.loginUsernameInput.value,
        password: els.loginPasswordInput.value
      })
    });
    state.authenticated = true;
    state.setupRequired = data.setupRequired;
    state.currentUser = data.user;
    els.loginPasswordInput.value = "";
    showApp();
    await loadSites({ keepSelection: false });
    await loadUsers();
    showToast(state.setupRequired ? "已创建管理员" : "已登录");
  } catch (error) {
    showToast(error.message);
  }
}

async function logout() {
  await request("/api/auth/logout", { method: "POST" }).catch(() => {});
  state.authenticated = false;
  state.currentUser = null;
  state.sites = [];
  state.users = [];
  await loadAuthStatus();
}

async function loadUsers() {
  if (!state.authenticated) return;
  const data = await request("/api/users");
  state.users = data.users || [];
  state.currentUser = data.currentUser || state.currentUser;
  renderUsers();
}

function renderUsers() {
  if (!els.userList) return;
  if (!state.users.length) {
    els.userList.innerHTML = `<div class="empty compact">还没有本地用户</div>`;
    return;
  }
  els.userList.innerHTML = "";
  for (const user of state.users) {
    const item = document.createElement("div");
    item.className = "user-item";
    item.innerHTML = `
      <span></span>
      <button class="icon-button" type="button" title="删除用户" aria-label="删除用户">×</button>
    `;
    item.querySelector("span").textContent = `${user.username}${user.id === state.currentUser?.id ? " · 当前" : ""}`;
    const button = item.querySelector("button");
    button.disabled = user.id === state.currentUser?.id || state.users.length <= 1;
    button.addEventListener("click", () => deleteUser(user));
    els.userList.append(item);
  }
}

async function createUser(event) {
  event.preventDefault();
  try {
    await request("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: els.newUsernameInput.value,
        password: els.newPasswordInput.value
      })
    });
    els.newUsernameInput.value = "";
    els.newPasswordInput.value = "";
    await loadUsers();
    showToast("已添加本地管理员");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteUser(user) {
  if (!window.confirm(`删除本地用户“${user.username}”？`)) return;
  try {
    await request(`/api/users/${user.id}`, { method: "DELETE" });
    await loadUsers();
    showToast("已删除本地用户");
  } catch (error) {
    showToast(error.message);
  }
}

async function loadSites({ keepSelection = true } = {}) {
  const data = await request("/api/sites");
  state.sites = data.sites || [];
  state.permissionDefinitions = data.permissionDefinitions || [];
  state.backupStrategies = data.backupStrategies || [];
  if (!keepSelection || !state.sites.some((site) => site.id === state.selectedId)) {
    state.selectedId = state.sites[0]?.id || null;
  }
  await loadConfigPreview();
  await loadBackupRecords();
  await loadUsers();
  render();
}

async function loadConfigPreview() {
  const site = selectedSite();
  state.config = null;
  if (!site) return;

  try {
    const data = await request(`/api/sites/${site.id}/config`);
    state.config = data.config;
  } catch {
    state.config = null;
  }
}

async function loadBackupRecords() {
  const site = selectedSite();
  state.backupRecords = [];
  if (!site) return;

  try {
    const data = await request(`/api/sites/${site.id}/backups`);
    state.backupRecords = data.backups || [];
    const index = state.sites.findIndex((item) => item.id === site.id);
    if (index !== -1 && data.backup) {
      state.sites[index] = {
        ...state.sites[index],
        backup: data.backup
      };
    }
  } catch {
    state.backupRecords = [];
  }
}

function renderList() {
  const search = state.search.trim().toLowerCase();
  const sites = state.sites.filter((site) => {
    const haystack = `${site.name} ${site.siteUrl} ${site.endpointUrl} ${site.serverName} ${site.username} ${site.notes}`.toLowerCase();
    return haystack.includes(search);
  });

  if (!sites.length) {
    els.siteList.innerHTML = `<div class="empty">${state.sites.length ? "没有匹配的站点" : "还没有保存站点"}</div>`;
    return;
  }

  els.siteList.innerHTML = "";
  for (const site of sites) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `site-item${site.id === state.selectedId ? " active" : ""}`;
    const ok = site.lastStatus?.ok === true;
    const failed = site.lastStatus?.ok === false;
    button.innerHTML = `
      <span class="site-name"></span>
      <span class="pill ${ok ? "ok" : failed ? "fail" : ""}"></span>
      <span class="site-url"></span>
    `;
    button.querySelector(".site-name").textContent = site.name;
    button.querySelector(".site-url").textContent = site.endpointUrl;
    button.querySelector(".pill").textContent = ok ? "正常" : failed ? "失败" : authModeLabel(site.authMode);
    button.addEventListener("click", async () => {
      state.selectedId = site.id;
      await loadConfigPreview();
      await loadBackupRecords();
      render();
    });
    els.siteList.append(button);
  }
}

function renderStatus(site) {
  const dot = els.statusStrip.querySelector(".status-dot");
  dot.className = "status-dot idle";

  if (!site) {
    els.statusText.textContent = "MCP 客户端配置只引用本机启动器，密钥仍在本地加密库中。";
    els.statusMeta.textContent = "等待保存";
    els.lastChecked.textContent = "暂无";
    els.latency.textContent = "暂无";
    els.authSummary.textContent = "暂无";
    return;
  }

  const status = site.lastStatus;
  els.authSummary.textContent = `${authModeLabel(site.authMode)}${site.username ? ` · ${site.username}` : ""}`;

  if (!status) {
    els.statusText.textContent = "尚未测试 MCP Endpoint";
    els.statusMeta.textContent = site.hasSecret?.password || site.hasSecret?.jwt || site.hasSecret?.customHeaders ? "已保存授权" : "无密钥或等待 OAuth";
    els.lastChecked.textContent = "暂无";
    els.latency.textContent = "暂无";
    return;
  }

  dot.className = `status-dot ${status.ok ? "ok" : "fail"}`;
  els.statusText.textContent = status.message || (status.ok ? "Endpoint 可访问" : "Endpoint 不可访问");
  els.statusMeta.textContent = `HTTP ${status.statusCode || "-"} · ${formatDate(status.checkedAt)}`;
  els.lastChecked.textContent = formatDate(status.checkedAt);
  els.latency.textContent = status.latencyMs ? `${status.latencyMs} ms` : "暂无";
}

function backupStrategyByKey(key) {
  return state.backupStrategies.find((strategy) => strategy.key === key)
    || state.backupStrategies.find((strategy) => strategy.key === "off")
    || state.backupStrategies[0]
    || null;
}

function backupSettingsForSite(site) {
  const strategy = backupStrategyByKey(site?.backup?.strategy);
  return {
    ...(strategy || {}),
    ...(site?.backup || {})
  };
}

function renderBackupStrategyOptions() {
  const current = els.backupStrategySelect.value;
  els.backupStrategySelect.innerHTML = "";
  for (const strategy of state.backupStrategies) {
    const option = document.createElement("option");
    option.value = strategy.key;
    option.textContent = strategy.label;
    els.backupStrategySelect.append(option);
  }
  if (current && state.backupStrategies.some((strategy) => strategy.key === current)) {
    els.backupStrategySelect.value = current;
  }
}

function renderBackupControls(site) {
  renderBackupStrategyOptions();
  const settings = backupSettingsForSite(site);
  const strategy = backupStrategyByKey(settings.strategy);

  els.runBackupButton.disabled = state.busy || state.backupBusy || !site;
  els.backupStrategySelect.value = settings.strategy || strategy?.key || "";
  els.backupRetentionInput.value = settings.retention ?? strategy?.retention ?? 0;
  els.beforeWriteBackupInput.checked = Boolean(settings.beforeWriteBackup);
  els.includeMediaCatalogInput.checked = Boolean(settings.includeMediaCatalog);
  els.backupStrategyHint.textContent = site
    ? strategy?.description || "已启用本地恢复点"
    : "等待保存站点";
}

function renderBackupStatus(site) {
  if (!site) {
    els.backupStrategyStatus.textContent = "暂无";
    els.lastBackupStatus.textContent = "暂无";
    els.backupList.innerHTML = `<div class="empty compact">保存站点后可创建恢复点</div>`;
    return;
  }

  const backup = backupSettingsForSite(site);
  els.backupStrategyStatus.textContent = backup.label || backup.strategy || "暂无";
  if (!backup.lastStatus) {
    els.lastBackupStatus.textContent = "尚未备份";
  } else {
    els.lastBackupStatus.textContent = backup.lastStatus.ok
      ? `${formatDate(backup.lastStatus.checkedAt)} · ${formatBytes(backup.lastStatus.sizeBytes)}`
      : `失败 · ${backup.lastStatus.message}`;
  }

  if (!state.backupRecords.length) {
    els.backupList.innerHTML = `<div class="empty compact">还没有恢复点</div>`;
    return;
  }

  els.backupList.innerHTML = "";
  for (const record of state.backupRecords.slice(0, 5)) {
    const item = document.createElement("div");
    item.className = "backup-item";
    item.innerHTML = `
      <span class="backup-item-main"></span>
      <span class="backup-item-meta"></span>
    `;
    item.querySelector(".backup-item-main").textContent = `${formatDate(record.createdAt)} · ${record.trigger || "manual"}`;
    item.querySelector(".backup-item-meta").textContent = `${formatBytes(record.sizeBytes)} · ${record.source || "backup"}`;
    els.backupList.append(item);
  }
}

function renderForm() {
  const site = selectedSite();
  els.modeLabel.textContent = site ? "编辑连接" : "新增连接";
  els.pageTitle.textContent = site ? site.name : "添加一个 WordPress MCP 站点";
  els.deleteButton.classList.toggle("hidden", !site);
  els.testButton.disabled = state.busy || !site;
  els.configButton.disabled = state.busy || !site;

  els.adminLink.classList.toggle("disabled", !site);
  if (site) {
    els.adminLink.href = site.adminUrl;
    els.nameInput.value = site.name;
    els.serverNameInput.value = site.serverName;
    els.siteUrlInput.value = site.siteUrl;
    els.endpointUrlInput.value = site.endpointUrl;
    els.usernameInput.value = site.username || "";
    els.passwordInput.value = "";
    els.jwtInput.value = "";
    els.customHeadersInput.value = "";
    els.wooKeyInput.value = site.wooKey || "";
    els.wooSecretInput.value = "";
    els.notesInput.value = site.notes || "";
    els.form.authMode.value = site.authMode;
  } else if (!els.siteUrlInput.value && !els.endpointUrlInput.value) {
    els.form.authMode.value = "oauth";
  }

  syncAuthMode();
  renderBackupControls(site);
  renderPermissions(site);
  renderConfig();
  renderStatus(site);
  renderBackupStatus(site);
}

function permissionDescription(key) {
  return {
    contentWrite: "允许创建和更新文章、页面、CPT 内容",
    mediaUpload: "允许上传本地文件或公网图片到媒体库",
    taxonomyWrite: "允许新增分类、标签、自定义板块词条",
    seoGeo: "允许更新 SEO 元数据、Schema、llms.txt",
    backupManage: "允许创建本地恢复点和读取备份状态",
    cacheManage: "允许通过 companion 清理 LiteSpeed Cache",
    menuWrite: "允许新增导航菜单项",
    settingsManage: "允许改站点设置、缓存策略",
    codeSnippets: "允许创建 PHP 代码片段",
    usersManage: "允许用户相关能力",
    pluginThemeManage: "允许安装、更新、启停插件或主题",
    packageInstall: "允许通过 companion 安装本地 zip 包",
    destructiveDelete: "允许删除文章、页面、媒体、分类等"
  }[key] || "控制这一类 MCP 能力是否开放";
}

function renderPermissions(site) {
  const permissions = site?.permissions || {};
  els.permissionGrid.innerHTML = "";

  for (const definition of state.permissionDefinitions) {
    const enabled = permissions[definition.key] ?? definition.defaultEnabled;
    const label = document.createElement("label");
    label.className = `permission-toggle${definition.key === "cacheManage" || definition.key === "packageInstall" || definition.key === "pluginThemeManage" || definition.key === "codeSnippets" || definition.key === "usersManage" || definition.key === "destructiveDelete" ? " high-risk" : ""}`;
    label.innerHTML = `
      <input type="checkbox" name="permission:${definition.key}" />
      <span class="toggle-ui" aria-hidden="true"></span>
      <span class="permission-copy">
        <strong></strong>
        <small></small>
      </span>
    `;
    const input = label.querySelector("input");
    input.checked = Boolean(enabled);
    label.querySelector("strong").textContent = definition.label;
    label.querySelector("small").textContent = permissionDescription(definition.key);
    els.permissionGrid.append(label);
  }
}

function renderConfig() {
  els.configPreview.textContent = state.config
    ? JSON.stringify(state.config, null, 2)
    : "{}";
}

function render() {
  renderList();
  renderForm();
}

function resetForm() {
  state.selectedId = null;
  state.config = null;
  state.backupRecords = [];
  els.form.reset();
  for (const input of [els.passwordInput, els.jwtInput, els.wooSecretInput]) input.type = "password";
  syncAuthMode();
  render();
}

function syncAuthMode() {
  const mode = els.form.authMode.value;
  document.querySelectorAll("[data-auth-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.authPanel !== mode);
  });
  els.usernameInput.required = mode === "application-password";
  els.passwordInput.required = false;
  els.jwtInput.required = false;
  els.customHeadersInput.required = false;
}

function formPayload() {
  const permissions = {};
  for (const definition of state.permissionDefinitions) {
    const input = els.form.querySelector(`[name="permission:${definition.key}"]`);
    permissions[definition.key] = input ? input.checked : definition.defaultEnabled;
  }

  return {
    name: els.nameInput.value,
    serverName: els.serverNameInput.value,
    siteUrl: els.siteUrlInput.value,
    endpointUrl: els.endpointUrlInput.value,
    authMode: els.form.authMode.value,
    username: els.usernameInput.value,
    password: els.passwordInput.value,
    jwt: els.jwtInput.value,
    customHeaders: els.customHeadersInput.value,
    wooKey: els.wooKeyInput.value,
    wooSecret: els.wooSecretInput.value,
    notes: els.notesInput.value,
    permissions,
    backup: {
      strategy: els.backupStrategySelect.value,
      retention: Number(els.backupRetentionInput.value || 0),
      beforeWriteBackup: els.beforeWriteBackupInput.checked,
      includeMediaCatalog: els.includeMediaCatalogInput.checked
    }
  };
}

async function saveSite(event) {
  event.preventDefault();
  const site = selectedSite();
  setBusy(true);
  try {
    const payload = formPayload();
    const data = site
      ? await request(`/api/sites/${site.id}`, { method: "PUT", body: JSON.stringify(payload) })
      : await request("/api/sites", { method: "POST", body: JSON.stringify(payload) });

    state.selectedId = data.site.id;
    els.passwordInput.value = "";
    els.jwtInput.value = "";
    els.customHeadersInput.value = "";
    els.wooSecretInput.value = "";
    await loadSites();
    if (data.companionSync?.ok === false) {
      showToast(data.companionSync.missingCompanion
        ? "功能开启失败：需要先在 WP 后台启用 companion plugin；GitHub 下载地址见权限开关说明"
        : `已保存本地权限；companion 未同步：${data.companionSync.message}`);
    } else {
      showToast("已保存权限与连接");
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function deleteSite() {
  const site = selectedSite();
  if (!site) return;
  const confirmed = window.confirm(`删除“${site.name}”？本地保存的授权也会一起删除。`);
  if (!confirmed) return;

  setBusy(true);
  try {
    await request(`/api/sites/${site.id}`, { method: "DELETE" });
    state.selectedId = null;
    await loadSites({ keepSelection: false });
    showToast("已删除");
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function testConnection() {
  const site = selectedSite();
  if (!site) return;
  const dot = els.statusStrip.querySelector(".status-dot");
  dot.className = "status-dot busy";
  els.statusText.textContent = "正在测试 MCP Endpoint";
  els.statusMeta.textContent = site.endpointUrl;
  setBusy(true);

  try {
    const data = await request(`/api/sites/${site.id}/test`, { method: "POST" });
    const index = state.sites.findIndex((item) => item.id === site.id);
    if (index !== -1) state.sites[index] = data.site;
    render();
    showToast(data.result.ok ? "Endpoint 可访问" : data.result.message);
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
    render();
  }
}

async function copyConfig() {
  const site = selectedSite();
  if (!site) return;

  try {
    const data = await request(`/api/sites/${site.id}/config`);
    state.config = data.config;
    renderConfig();
    const text = JSON.stringify(data.config, null, 2);
    const copied = await copyText(text);
    if (copied) {
      showToast("已复制 MCP 客户端配置");
    } else {
      selectConfigPreview();
      showToast("浏览器禁止自动复制，已选中右侧配置");
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function runManualBackup() {
  const site = selectedSite();
  if (!site) return;
  setBackupBusy(true);
  els.backupStrategyHint.textContent = "正在创建恢复点";

  try {
    const data = await request(`/api/sites/${site.id}/backup`, { method: "POST" });
    const index = state.sites.findIndex((item) => item.id === site.id);
    if (index !== -1 && data.backup) {
      state.sites[index] = {
        ...state.sites[index],
        backup: data.backup
      };
    }
    state.backupRecords = data.backups || [];
    render();
    showToast("已创建恢复点");
  } catch (error) {
    await loadSites().catch(() => {});
    showToast(error.message);
  } finally {
    setBackupBusy(false);
    render();
  }
}

function applySelectedBackupStrategyDefaults() {
  const strategy = backupStrategyByKey(els.backupStrategySelect.value);
  if (!strategy) return;
  els.backupRetentionInput.value = strategy.retention ?? 0;
  els.beforeWriteBackupInput.checked = Boolean(strategy.beforeWriteBackup);
  els.includeMediaCatalogInput.checked = Boolean(strategy.includeMediaCatalog);
  els.backupStrategyHint.textContent = strategy.description || "";
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to the older selection-based copy path.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.body.append(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function selectConfigPreview() {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(els.configPreview);
  selection.removeAllRanges();
  selection.addRange(range);
}

els.form.addEventListener("submit", saveSite);
els.authForm.addEventListener("submit", submitAuth);
els.logoutButton.addEventListener("click", logout);
els.userForm.addEventListener("submit", createUser);
els.deleteButton.addEventListener("click", deleteSite);
els.resetButton.addEventListener("click", resetForm);
els.newSiteButton.addEventListener("click", resetForm);
els.testButton.addEventListener("click", testConnection);
els.configButton.addEventListener("click", copyConfig);
els.runBackupButton.addEventListener("click", runManualBackup);
els.backupStrategySelect.addEventListener("change", applySelectedBackupStrategyDefaults);
els.refreshButton.addEventListener("click", () => loadSites().catch((error) => showToast(error.message)));
els.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderList();
});
els.siteUrlInput.addEventListener("blur", () => {
  if (!els.endpointUrlInput.value.trim()) {
    els.endpointUrlInput.value = defaultEndpoint(els.siteUrlInput.value);
  }
});
document.querySelectorAll('input[name="authMode"]').forEach((input) => {
  input.addEventListener("change", syncAuthMode);
});
document.querySelectorAll(".secret-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.querySelector(`#${button.dataset.target}`);
    input.type = input.type === "password" ? "text" : "password";
    input.focus();
  });
});

loadAuthStatus()
  .then((authenticated) => authenticated ? loadSites({ keepSelection: false }) : null)
  .catch((error) => showToast(error.message));
