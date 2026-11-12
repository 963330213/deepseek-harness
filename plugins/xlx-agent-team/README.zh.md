---
description: "在 DeepSeek Harness Web 中安装和配置可复用的智能体团队，由主智能体自动分工。包含源码构建与服务器安装方法。"
kind: "package-bundle"
---

# dsh-xlx-agent-team

[English](README.md) | 中文

## 摘要

此本地插件在 Web 的插件页面中提供可编辑的智能体团队。每个成员具有名称、固定标识、职责提示词、启用状态和可选模型。主智能体通过内置子智能体运行时分派合适的任务并接收结果。成员配置属于当前配置档案（profile），沿用现有配置权限。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制](#known-limitations)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用此包

### 从源码仓库启动

换电脑时，把源码仓库及其中的 `plugins/` 目录一起复制过去。使用 Node 24.9 及以上版本，从仓库根目录构建 DSH 和团队插件。

```sh
pnpm install
pnpm run build
pnpm --dir plugins/xlx-agent-team install --ignore-workspace --config.auto-install-peers=false --frozen-lockfile
pnpm exec tsdown --cwd plugins/xlx-agent-team --config-loader native
```

通过 Web 配置档案或 `DSH_XLX_AUTH_CONFIG` 配置授权插件。首次创建空授权数据库时设置 `DSH_XLX_BOOTSTRAP_PASSWORD`。执行 `pnpm dsh web` 将本地组合包安装到 Web 配置档案并启动服务。

刷新 Web 页面，点击左侧栏的 **智能体团队** 即可新增成员。也可以通过 **插件 → 智能体团队** 打开同一配置界面。保存后配置会持久化。成员标识以小写字母开头，最多 32 个字母、数字或短横线，不能是 `lead`。创建后不能修改标识。模型可以选择“沿用主智能体模型”或已配置提供方中的模型。如果其他页面修改了配置，请重新打开编辑窗口后保存。

### 成员专属能力

在成员编辑窗口中配置 **专属 MCP**、**专属 Skill** 和 **数据库**。三个页签均显示列表，提供状态开关及编辑、移除操作；点击 **添加** 或 **编辑** 打开独立表单。点击 **确定** 将修改放回列表，点击成员窗口的 **保存** 后持久化；取消表单会放弃其中的修改。每个成员的新增能力独立管理，不会注册到主智能体或其他成员。继承的智能体预设所提供的基础工具和共享技能仍然可用。

- **MCP：** 选择 STDIO，粘贴只包含一个服务的 `mcpServers` JSON；或选择 Streamable HTTP，填写服务地址和请求头。STDIO 必须包含 `command`，可填写 `args`、`env` 和 `cwd`，服务键作为命名空间。两种协议均可设置超时。敏感值使用 `${credential:REFERENCE_NAME}`，实际值在 DSH 凭据中管理。服务必须成功连接后成员才能启动。STDIO 所需的程序须安装在服务端。
- **Skill：** 上传包含一个 `SKILL.md` 及其相对路径脚本和资源的 ZIP。YAML 头部必须包含 `name` 和 `description`，名称采用与成员相同的小写标识格式。修改文件时上传新的 ZIP；已有 Skill 可继续使用。导入不会执行脚本。每个成员的技能文件合计最多 1 MiB，每个技能最多 128 个文件。同一成员内的技能名称不可重复。
- **数据库**支持配置 MySQL 主机、端口、库名、只读用户名、密码凭据引用、TLS、返回行数和超时。保存成员后重新打开连接，在 **开放数据表** 中搜索或翻页浏览物理表。选表后勾选所需字段，每张表最多 200 个。只有所有者能通过已保存的连接读取表结构。每张表都必须明确配置字段。没有开放表时仅可测试连接。在 **SQL 示例** 中可添加问题、使用 `?` 占位符的 SELECT、按顺序填写的参数说明，以及业务口径和单位。

让受委派成员调用 `team_database` 的 `catalog`、`test` 或 `schema` 查看其专属连接。查询前先以相同 SQL 和 JSON 参数值执行 `explain`，检查成本和索引后再执行 `query`。工具使用预编译语句、只读事务和 MySQL 执行时限，最多返回 1,000 行。返回、筛选、关联、分组和排序只能使用开放字段。关联查询须限定字段所属表并显式使用 `ON`；排序使用开放字段或其表达式。支持 `COUNT(*)`，拒绝 `SELECT *`、写操作、子查询、CTE、UNION 和清单之外的函数。表结构只返回开放字段及完全由这些字段组成的索引。结果达到行数上限时可能被截断。支持 MySQL 5.7 及以上版本，不支持 MariaDB 或其他数据库。

例如，确认实际字段后允许访问 `orders`，为“指定业务日期范围内的实付金额”配置 `SELECT SUM(paid_amount) AS total_amount FROM orders WHERE business_time >= ? AND business_time < ?`，并填写两个日期参数及金额存储单位。这是配置模板，不表示你的数据库具有这些字段。连接测试和查询错误显示在成员的工具结果中；编辑页保存时不会连接数据库。

### 服务器安装

先按上述命令在本地构建插件，再生成可分发的安装包：

```sh
pnpm --dir plugins/xlx-agent-team pack
```

将 `plugins/xlx-agent-team/dsh-xlx-agent-team-0.1.0.tgz` 复制到服务器。在安装包所在目录，使用服务器上的 DSH 和提供 Web 服务的配置档案执行：

```sh
dsh plugin --profile web add ./dsh-xlx-agent-team-0.1.0.tgz
```

安装包包含已编译的服务端和浏览器代码、补丁与翻译。服务器需要相同 DSH 版本，Web 配置档案中需要启用内置子智能体、spawn 提供方、团队和模型服务。凭据仍由服务器现有的模型提供方配置管理。安装包不包含本地成员配置或凭据。

配置档案还需提供内置 storage-domain、技能和凭据服务。安装依赖时需要能够访问配置的软件包源。配置的本地 MCP 服务程序和凭据引用也需要在服务器上准备。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

[cordis.patch.yml](cordis.patch.yml) 插入 `xlx-agent-team` 条目。其 `enabled` 和 `members` 配置支持实时更新。`members` 是以成员标识为键的字典，每个值包含 `name`、`instructions`、`enabled`、`provider` 和 `model`。提供方和模型均为空字符串时沿用主智能体模型；指定独立模型时两项必须同时填写。

[src/index.ts](src/index.ts) 通过 Cordis 副作用注册成员发现、任务委派和主智能体提示。它在启动任务前验证模型，在异步准备后重新检查成员配置，并复用现有子智能体生命周期和会话日志。首次委派会启用该会话的共享任务板。[客户端控制器](src/client/controller.ts) 使用带版本检查的配置写入，并在卸载时等待已发出的请求结束。

[成员运行时](src/member-runtime.ts) 在创建子智能体前，把接受的能力配置保存到 `xlx_team_capabilities` 存储域。创建和冷恢复时通过子会话标识读取该配置快照，备份会话时应同时备份此存储域。子智能体拥有的插件挂载 MCP 连接、临时技能目录和数据库工具；子智能体释放时关闭连接、清理资源并等待数据库操作结束。[数据库校验](src/database.ts) 使用 node-sql-parser 检查 SQL，并通过 mysql2 绑定参数。

</details>

<a id="model-experience"></a>
## 模型体验

插件有启用且可供会话使用的成员时，根智能体可使用 `team_members` 和 `team_delegate`。安装 XLX Auth 后，会话的角色授权决定主智能体能看到、启动或继续联系哪些成员。对于授权受限的会话，若历史委派未记录成员标识，需要重新委派才能继续该任务。委派会将职责与任务写入子智能体的首条消息日志，并返回运行名称。

<a id="known-limitations"></a>
## 已知限制

自动分工取决于主模型的决策。成员沿用现有子智能体的并发和深度限制。已启动的任务保留启动时的职责和模型；编辑、停用或删除成员只影响后续委派。停用本插件不会取消已运行的子智能体，也不会清空会话任务板。职责提示词是工作指导，不是文件系统权限策略。配置界面面向 Web，不新增桌面端设置页面。

能力配置快照同样保留，成员编辑或删除不会改变已有任务；每次数据库操作或 MCP 连接时重新解析凭据。冷恢复这些能力时需要保留本插件。作用域隔离控制能力发现与注册，不等于操作系统隔离：配置的进程和脚本沿用服务器既有执行权限。数据访问控制应使用数据库授权和已有预设、沙箱配置。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护上下文</summary>

此插件位于 `plugins/`，使用仓库共享的客户端打包器构建。服务端配置校验规则必须支持 JSON 序列化，以供浏览器表单恢复校验。扩展时复用内置子智能体运行时、模型列表、控件和本地化字典。

</details>
