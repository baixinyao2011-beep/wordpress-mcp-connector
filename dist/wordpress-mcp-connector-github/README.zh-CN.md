# WordPress MCP 连接器

这是一个本地运行的 WordPress MCP 连接器，用来集中管理多个 WordPress 网站的后台授权信息、MCP 配置和高风险权限开关。

它的核心目的很简单：不要把 WordPress 应用密码、Bearer Token、JWT、Basic Auth Header 等敏感信息粘贴到聊天窗口里，也不要把这些密钥直接写进 MCP 客户端配置。

本工具会把站点授权信息加密保存在你自己的电脑上。Codex、Workbuddy 或其他 MCP 客户端拿到的只是一个本地启动配置和站点 ID，不会直接看到 WordPress 密码。

## 它包含什么

- 本地网页管理界面：添加站点、测试 MCP endpoint、复制 MCP 配置、管理权限开关。
- 本地加密存储：保存 WordPress 授权信息、站点配置和用户登录信息。
- 本地 MCP 启动器：让 Codex/Workbuddy 通过站点 ID 连接 WordPress MCP。
- WordPress companion plugin：补充 `/llms.txt`、`/llms-full.txt`、站点侧备份导出、LiteSpeed 清缓存、本地 zip 包安装和权限同步等能力。

## 安装要求

- Node.js 20 或更高版本。
- 每个 WordPress 网站都需要安装 `MCP Adapter`。
- 如果要真正管理文章、页面、分类、SEO、GEO、媒体、CPT 等内容，需要安装 `Enable Abilities for MCP`。
- 如果要使用 `/llms.txt`、`/llms-full.txt`、站点侧备份导出、LiteSpeed 清缓存、本地插件/主题 zip 包安装、权限同步等增强功能，需要安装本项目附带的 companion plugin。

## 第一步：启动本地连接器

下载本仓库后，在项目目录运行：

```bash
npm start
```

启动后，终端会显示一个本地管理地址，例如：

```text
WordPress MCP connector is running at http://127.0.0.1:54321
```

说明：

- `127.0.0.1` 表示只允许本机访问，这是安全设计，不建议改成公网或局域网地址。
- 后面的端口号会随机生成，不固定写死。
- 随机端口保存在本机的 `data/runtime.json`，不要公开分享这个地址。

第一次打开管理页面时，需要创建一个本地管理员账号。这个账号只用于保护本地管理界面，不是 WordPress 后台账号。

本地管理员密码规则：

- 至少 6 位。
- 不强制大小写。
- 不强制特殊符号。

## 第二步：WordPress 后台需要安装的插件

### 1. MCP Adapter

必装。它提供 WordPress MCP 的基础 endpoint。

GitHub 地址：

[https://github.com/WordPress/mcp-adapter](https://github.com/WordPress/mcp-adapter)

安装并启用后，默认 endpoint 通常是：

```text
https://your-site.example/wp-json/mcp/mcp-adapter-default-server
```

### 2. Enable Abilities for MCP

建议安装，实际内容管理基本需要它。

它负责把 WordPress 的文章、页面、分类、标签、媒体、SEO、CPT、WooCommerce 等能力暴露给 MCP。

安装方式：

```text
WordPress 后台 -> Plugins -> Add New Plugin -> 搜索 "Enable Abilities for MCP" -> Install -> Activate
```

启用后，进入它的设置页面，只开启你需要的 abilities。不要一次性开放所有高风险能力。

WordPress.org 页面：

[https://wordpress.org/plugins/enable-abilities-for-mcp/](https://wordpress.org/plugins/enable-abilities-for-mcp/)

### 3. WordPress MCP Connector Companion

可选，但如果你希望功能完整，建议安装。

它用于补充这些能力：

- 管理 `/llms.txt`
- 管理 `/llms-full.txt`
- 导出文章、页面、CPT、分类、菜单、SEO 常见元数据和媒体库清单，供本地恢复点使用
- 清理 LiteSpeed Cache
- 允许本地插件/主题 `.zip` 包安装
- 和本地管理页面同步部分高风险权限开关

源码位置：

[wordpress-plugin/wordpress-mcp-connector-companion](wordpress-plugin/wordpress-mcp-connector-companion)

可直接上传到 WordPress 后台的 zip 包：

[wordpress-plugin/wordpress-mcp-connector-companion.zip](wordpress-plugin/wordpress-mcp-connector-companion.zip)

WordPress 后台安装路径：

```text
Plugins -> Add New Plugin -> Upload Plugin
```

如果本地管理页面提示 companion plugin 未响应，通常表示：

- companion plugin 没有安装；
- companion plugin 没有启用；
- companion plugin 版本过旧；
- 当前 WordPress 用户权限不足。

请在 WordPress 后台安装或更新 companion plugin 后，再回到本地管理页面保存权限开关。

## 第三步：添加网站

在本地管理页面中添加站点：

1. 填写站点名称。
2. 填写 MCP server 名称，例如 `wordpress-bydtoday`。
3. 填写 WordPress 站点地址。
4. 填写 MCP endpoint URL。
5. 选择授权方式。
6. 保存。
7. 点击测试 endpoint。
8. 复制生成的 MCP 客户端配置。

推荐授权方式：

- 团队或长期使用：WordPress Application Password。
- 能使用 OAuth 的场景：OAuth。
- 特殊部署：JWT 或自定义 Headers。

建议单独创建一个 WordPress 用户给 MCP 使用，只分配必要权限。不要使用你的主站管理员账号做日常自动化。

## 第四步：复制 MCP 配置

保存站点并测试通过后，点击复制配置。

生成的配置大致类似：

```json
{
  "mcpServers": {
    "wordpress-example": {
      "command": "node",
      "args": [
        "/absolute/path/to/bin/run-wordpress-mcp.js",
        "site-id"
      ]
    }
  }
}
```

这个配置里不会包含 WordPress 密码。真正的授权信息保存在本机加密文件里，由本地启动器在运行时读取。

## 权限开关说明

每个站点都有独立的权限开关。

默认开启：

- 文章与页面写入
- 媒体上传
- 分类与板块
- SEO 与 GEO

默认关闭的高风险能力：

- 菜单管理
- 站点设置
- LiteSpeed 清缓存
- 代码片段
- 用户管理
- 插件与主题管理
- 本地 zip 安装
- 删除操作

建议原则：

- 只开启当前任务需要的权限。
- 高风险权限用完就关。
- 本地 zip 安装只在安装可信插件或主题时短期开启。

## 备份与恢复点

每个站点可以在本地管理页面选择独立的备份策略：

- 默认：关闭备份。需要自动保护时再为对应站点开启。
- 每日守护：每天自动创建一个本地恢复点，写入或删除前也会按冷却时间先备份。
- 高频保护：适合近期大量改站点时使用，自动备份更频繁。
- 轻量内容：只保留内容结构和媒体库清单，恢复点数量更少。
- 手动备份：只在你点击“立即备份”或调用 MCP 备份工具时执行。

恢复点保存在本机 `data/backups/`。它是 JSON 内容快照，不会写入 WordPress 密码、令牌或 API key。当前恢复点包含内容、分类、菜单、常见 SEO/GEO 元数据和媒体库清单；媒体文件本体、服务器文件和完整数据库二进制仍建议由主机商或专业备份插件另行备份。

## 本地图片和文件上传

部分 WordPress MCP ability 只能导入公网图片链接，不能直接读取本机文件。

本工具额外提供本地上传能力：

```text
wordpress-upload-local-image
wordpress-upload-local-file
```

使用方法：

- 本地图片先用 `wordpress-upload-local-image` 上传到 WordPress 媒体库。
- 上传成功后，把返回的 `attachment_id` 作为文章特色图 ID，或把返回的 URL 插入正文。
- PDF、文档、表格等文件可以用 `wordpress-upload-local-file` 上传。

## 安全注意事项

请不要提交或分享这些本地文件：

```text
data/sites.json
data/users.json
data/runtime.json
.wp-connector-key
.env
```

这些文件已经被 `.gitignore` 忽略，属于每台电脑自己的本地数据。

安全建议：

- 不要把 WordPress 密码、应用密码、JWT、Bearer Token 粘贴到聊天窗口。
- 如果密钥曾经出现在聊天记录、日志、issue、Git 历史中，请立即废弃并重新生成。
- 本地管理页面应保持绑定 `127.0.0.1`。
- 不要把本地管理地址暴露到公网。
- 为 MCP 创建单独的 WordPress 用户。
- 给这个用户只分配必要权限。
- 高风险权限默认关闭，需要时再打开。

## 常见问题

### 为什么地址里仍然有 `127.0.0.1`？

这是安全设计。`127.0.0.1` 表示只有你自己的电脑能打开管理页面。随机的是端口号，不是这个本机地址。

### 为什么保存权限时提示 companion plugin 未同步？

这通常表示 WordPress 站点端没有安装或启用 companion plugin。请上传并启用：

[wordpress-plugin/wordpress-mcp-connector-companion.zip](wordpress-plugin/wordpress-mcp-connector-companion.zip)

### 旧的 WordPress 应用密码还能用吗？

如果旧密码曾经出现在聊天窗口、日志或历史文件里，建议在 WordPress 后台立即撤销，然后在本地管理页面录入新的应用密码。

### 可以分享给朋友用吗？

可以。朋友下载仓库后，应该在自己的电脑上启动本地连接器，并创建自己的本地管理员账号和站点授权信息。不要分享你的 `data` 目录或 `.wp-connector-key`。

## 更多文档

- 完整安装步骤：[docs/installation.md](docs/installation.md)
- Workbuddy 部署说明：[docs/workbuddy-deploy.md](docs/workbuddy-deploy.md)
- 能力边界说明：[docs/capabilities.md](docs/capabilities.md)
- 安全说明：[SECURITY.md](SECURITY.md)
