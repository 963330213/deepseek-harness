# DSH 项目用户权限

插件在当前 DSH Web 服务内提供登录和授权，并在“设置 → 用户权限”中管理用户、角色、账号启停和密码。插件不创建监听端口或用户 worker。账号数据库独立于业务数据库和 DSH 会话存储。

普通登录独立运行。需要使用 DSH 账号授权 MCP 客户端时，另行安装 [xlx-oauth](../optional/xlx-oauth/README.md)。

## 安装与配置

本插件依赖当前项目新增的 `connection.registerBrowserAuthentication` 接口，需要使用本仓库构建的 DSH。

```powershell
pnpm dsh plugin --profile web add E:/code/deepseek-harness/plugins/xlx-auth
```

在 Web profile 的 `cordis.patch.yml` 中指定配置文件，或设置 `DSH_XLX_AUTH_CONFIG`。配置字段为 `database`（SQLite 绝对路径）、`bootstrapUser`（首个管理员用户名）和 `workspacesDirectory`（用户工作区的绝对根路径）。首次创建空数据库前通过 `DSH_XLX_BOOTSTRAP_PASSWORD` 设置 6–256 个字符的管理员密码；数据库已有账号时不使用该变量。密码长度按浏览器表单的 UTF-16 长度计算，前后端限制一致。配置文件与数据库应仅允许运行 DSH 的系统账号读取。

```yaml
- id: xlx-auth
  config:
    file: C:/private/dsh-project-auth.json
```

插件组合层将 Connection 的 `authentication` 设置为 `plugin`，禁用原生启动 token 和 `/connect` 认证。账号插件缺失、启动失败或卸载时，项目接口拒绝访问。卸载时必须同时恢复 Connection 的原生认证配置。旧的独立网关配置不能启动此版本；其 SQLite 账号和密码可以保留使用。

## 用户和角色

`member` 允许使用 DSH。首次登录会创建用户专属工作区，工作区和会话的归属持久化在授权数据库中。HTTP 调用和 WebSocket 流复用 DSH 的 Remote 资源权限校验；普通用户只能创建、列出和读取自己的会话。子会话继承父会话的用户归属。

`admin` 允许管理用户权限，拥有项目所有设置、工作区和会话的访问权限。用户可分配多个角色，权限取并集。修改用户或角色撤销相关登录，并关闭已认证连接；禁止移除最后一个启用的管理员。编辑用户时不填写密码表示保留原密码。

设置页显示用户和角色总数，点击“管理用户”或“管理角色”打开列表弹窗。列表支持名称前缀查询、重置和每页 10 条的服务端分页；用户列表还支持启用状态筛选。新增和编辑在同一弹窗中完成，返回列表时保留查询条件和页码。角色选择也按页查询，已选角色与当前页角色合并为一个去重列表，跨页保留且可取消选择。查询使用名称索引和游标翻页，账号角色按当前页批量读取，不加载全量账号或使用深 OFFSET。窄窗口下表格转为可滚动的记录卡片。

## 当前限制

此版本实现项目登录、用户角色和会话的应用层隔离。逐智能体和逐 Skill 的授权尚未接入。普通用户暂不开放附件传输、全局模型设置、插件管理、归档和交互式审批回复；已运行的模型任务不会因退出登录自动终止。多个账号共用 DSH 进程和系统身份，工具执行的操作系统沙箱与文件访问限制仍由 DSH 部署承担，不应将工作区目录分配视为不可信租户的系统级隔离。

## 验证

`node --test plugins/xlx-auth/test/project.test.js` 检查账号持久化、角色修改、CSRF、管理员保护、撤销和会话归属。项目 Connection 和 frontend-static 测试覆盖原生认证兼容性与插件认证失效时的拒绝行为。UI 通过标准 `settings.section` 插槽和共享组件装配，支持中文、英文及现有主题。

在已安装 Chrome 的本仓库开发环境中设置 `DSH_XLX_BROWSER_TEST=1` 后运行同一测试，可验证真实表单提交、错误提示和登录后的重定向。登录页使用 `Referrer-Policy: same-origin` 保留表单的同源 Origin；空来源和跨站提交仍被拒绝，登录失败显示表单内提示。

`test/client.test.js` 使用已启动的 DSH Web 页面验证管理弹窗。设置 `DSH_XLX_UI_URL`、`DSH_XLX_UI_USER`（默认 `admin`）和 `DSH_XLX_UI_PASSWORD` 后执行 `node --test plugins/xlx-auth/test/client.test.js`。该测试登录后通过浏览器请求替身提供 137 个用户和 35 个角色，拦截全部管理写入，不改变实际账号；覆盖分页、查询、筛选、错误保留、跨页角色选择、关闭和焦点恢复，并输出浅色、深色和窄窗口截图到系统临时目录。登录仍遵循单账号单来源登录策略，运行时使用测试账号可避免撤销操作者的同账号登录。
