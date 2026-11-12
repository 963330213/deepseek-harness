# DSH 本地 OAuth 授权

`xlx-oauth` 在当前 DSH Web 服务上提供 MCP 授权确认页。它使用同一 Web profile 中的 `xlx-auth` 账号、工作区和会话权限。MCP 客户端发现 DSH 的 OAuth 端点后，通过浏览器登录 DSH 并选择允许或拒绝。

## 安装与配置

从源码仓库根目录执行以下命令，安装后重启 DSH Web。

```sh
pnpm dsh plugin --profile web add ./plugins/optional/xlx-oauth
```

管理员打开「用户权限 → OAuth 授权 → 配置 MCP」，勾选「启用 MCP」，填写完整的 MCP 资源地址并保存。在本机使用 `http://localhost:3080/mcp`，客户端回调可使用 `http://127.0.0.1:端口/回调路径`。客户端需要支持动态注册、授权码和 S256 PKCE。回调使用带显式端口的回环地址，主机名需与 DSH 登录页不同，以隔离浏览器会话 Cookie。

也可以在 Web profile 的 `cordis.patch.yml` 中设置初始地址。管理员保存过配置后，以保存的值为准。

```yaml
- id: xlx-oauth
  config:
    resource: http://localhost:3080/mcp
```

非回环的 DSH 地址使用 HTTPS，反向代理保留资源地址的 Host。接入原外部授权中心的配置和凭据记录不会启用本地授权。首次使用时按本页配置，并由客户端重新授权。

## 访问范围

客户端使用浏览器登录的 DSH 账号访问其工作区和会话。授权仅允许 `dsh_create_session`、`dsh_list_sessions`、`dsh_send_message` 和 `dsh_read_replies`，管理员账号的 MCP 访问也受会话归属限制。账号停用或撤销使用权限后，MCP 拒绝请求。

访问令牌有效期为一小时。重启 DSH Web、关闭 MCP 或更改资源地址会让当前令牌失效，客户端需要重新授权。动态注册的客户端 ID 按资源地址保存在项目数据库旁的 SQLite 文件中。

## 验证

从仓库根目录运行 `pnpm --dir plugins/optional/xlx-oauth install --ignore-workspace --frozen-lockfile` 和 `pnpm --dir plugins/optional/xlx-oauth test`。测试覆盖本地登录和授权确认、拒绝授权、受众校验、授权码重放及会话隔离。

手动验证运行 `node plugins/optional/xlx-oauth/test/local-oauth-smoke.mjs`。在浏览器打开终端打印的链接并确认授权后，终端会显示令牌兑换和读取会话列表的结果。
