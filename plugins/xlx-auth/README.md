# DSH 项目用户权限

插件在当前 DSH Web 服务内提供登录和授权。管理员从左侧栏的「用户权限」管理用户、角色、账号启停和密码。账号数据库独立于业务数据库和 DSH 会话存储。

后台登录要求账号拥有 `admin` 角色。插件同时提供 MCP 客户端的 OAuth 授权。

## 安装与配置

本插件依赖 `connection.registerBrowserAuthentication` 接口，需要使用本仓库构建的 DSH。从源码安装时，在仓库根目录执行以下命令：

```powershell
pnpm --dir plugins/xlx-auth install --ignore-workspace --frozen-lockfile
pnpm dsh plugin --profile web add ./plugins/xlx-auth
```

在 Web profile 的 `cordis.patch.yml` 中指定配置文件，或设置 `DSH_XLX_AUTH_CONFIG`。配置字段为 `database`（SQLite 绝对路径）、`bootstrapUser`（首个管理员用户名）和 `workspacesDirectory`（用户工作区的绝对根路径）。首次创建空数据库前通过 `DSH_XLX_BOOTSTRAP_PASSWORD` 设置 6–256 个字符的管理员密码；数据库已有账号时不使用该变量。密码长度按浏览器表单的 UTF-16 长度计算，前后端限制一致。配置文件与数据库应仅允许运行 DSH 的系统账号读取。

```yaml
- id: xlx-auth
  config:
    file: C:/private/dsh-project-auth.json
```

插件组合层将 Connection 的 `authentication` 设置为 `plugin`，禁用原生启动 token 和 `/connect` 认证。账号插件缺失、启动失败或卸载时，项目接口拒绝访问。卸载时必须同时恢复 Connection 的原生认证配置。旧的独立网关配置不能启动此版本；其 SQLite 账号和密码可以保留使用。

## OAuth 授权

管理员打开「用户权限 → OAuth 授权 → 配置 MCP」，勾选「启用 MCP」，填写完整的资源地址，例如 `http://localhost:3080/mcp`。非回环地址使用 HTTPS，反向代理保留资源地址的 Host。也可在 Web profile 的 `cordis.patch.yml` 中设置 `xlx-auth.config.mcpResource` 作为初始地址；管理员保存的配置优先。

MCP 客户端需要支持动态注册、授权码和 S256 PKCE。客户端回调使用带显式端口的回环地址，主机名须与 DSH 登录页不同，例如 `http://127.0.0.1:8787/callback`。

访问令牌有效期为一小时。重启 DSH Web、关闭 MCP 或更改资源地址会使当前令牌失效，客户端须重新授权。动态注册的客户端 ID 按资源地址保存在账号数据库旁的 SQLite 文件中。

## 用户和角色

`member` 允许使用 MCP。普通用户从 MCP 客户端发起 OAuth 授权，在有效请求的登录页验证身份。首次授权调用会准备用户专属工作区。MCP 提供 `dsh_create_session`、`dsh_list_sessions`、`dsh_send_message` 和 `dsh_read_replies`，所有账号的调用都受工作区和会话归属限制。子会话继承父会话的用户归属。

`admin` 是唯一能登录后台的角色，拥有项目所有设置、工作区和会话的访问权限。任一已分配角色具有「使用 MCP」权限即可授权 MCP。修改用户或角色的「使用 MCP」权限会撤销相关登录并关闭已认证的后台连接。系统要求至少保留一个已启用的 `admin` 账号。编辑用户时不填写密码表示保留原密码。

安装智能体团队插件后，在「用户权限 → 管理角色」编辑角色，在「授权智能体」中勾选可委派的成员。会话按归属账号的角色合并授权。后台中没有账号归属的会话使用 `admin` 角色的授权。普通角色初始没有成员权限，`admin` 初始授权全部成员。取消「授权全部智能体」后，可以为 `admin` 选择具体成员。

设置页显示用户和角色总数，点击“管理用户”或“管理角色”打开列表弹窗。列表支持名称前缀查询、重置和每页 10 条的服务端分页；用户列表还支持启用状态筛选。新增和编辑在同一弹窗中完成，返回列表时保留查询条件和页码。角色选择也按页查询，已选角色与当前页角色合并为一个去重列表，跨页保留且可取消选择。查询使用名称索引和游标翻页，账号角色按当前页批量读取，不加载全量账号或使用深 OFFSET。窄窗口下表格转为可滚动的记录卡片。

## 当前限制

多个账号共用 DSH 进程和系统身份，工具执行的操作系统沙箱与文件访问限制由 DSH 部署承担。已运行的模型任务会在账号退出登录后继续。

## 验证

启用 MCP 后，用具有「使用 MCP」权限的普通账号在客户端发起授权，登录并确认授权。调用 `dsh_list_sessions`，确认客户端只列出该账号的会话。使用同一账号直接登录 Web 后台应被拒绝。
