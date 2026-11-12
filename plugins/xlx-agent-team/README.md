---
description: "Install and configure a reusable agent roster for automatic delegation in DeepSeek Harness Web. Includes source builds and server package installation."
kind: "package-bundle"
---

# dsh-xlx-agent-team

English | [中文](README.zh.md)

## Summary

This local plugin adds an editable agent team to the Web Plugins page. Each member has a name, stable id, role instructions, enabled state and optional model selection. The lead delegates suitable tasks and receives results through the built-in subagent runtime. Member settings belong to the profile and use its existing configuration permissions.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations](#known-limitations)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

### Run from a source checkout

On a new machine, copy the checkout with its `plugins/` directories. Use Node 24.9 or newer. Build DSH and the team bundle from the repository root.

```sh
pnpm install
pnpm run build
pnpm --dir plugins/xlx-agent-team install --ignore-workspace --config.auto-install-peers=false --frozen-lockfile
pnpm exec tsdown --cwd plugins/xlx-agent-team --config-loader native
```

Configure the authorization plugin through the Web profile or `DSH_XLX_AUTH_CONFIG`. Set `DSH_XLX_BOOTSTRAP_PASSWORD` when creating an empty authorization database. Run `pnpm dsh web` to install the local bundles into the Web profile and start the server.

Refresh the Web page and open **Agent team** in the left sidebar to add members. The same editor is also available under **Plugins → Agent team**. Saving persists the roster. A member id starts with a lower-case letter, contains at most 32 letters, digits or hyphens, and cannot be `lead`. Ids cannot be edited after creation. Select **Inherit the lead model** or a model from the configured providers. If another page changes the settings, reopen the editor before saving again.

### Member capabilities

Open a member's editor to configure **Private MCP**, **Private skills**, and **Databases**. All three tabs show lists with status switches and edit/remove actions; **Add** or **Edit** opens a separate form. **Confirm** stages the change in the list; **Save** in the member editor persists it. Cancelling a form discards its changes. Each member owns separate additions; they are not registered on the lead or other members. The normal tools and shared skills provided by the inherited agent preset remain available.

- **MCP:** select STDIO and paste a single-server `mcpServers` JSON object, or select Streamable HTTP and enter the endpoint and request headers. The STDIO entry requires `command` and accepts `args`, `env`, and `cwd`; the server key is the namespace. Set the timeout for either protocol. Use `${credential:REFERENCE_NAME}` for secrets, with values managed in DSH Credentials. The service must connect successfully before the member starts. Install any required STDIO executable on the server.
- **Skills:** upload one ZIP containing a single `SKILL.md` and its relative scripts and resources. YAML frontmatter must contain `name` and `description`; names use the same lowercase identifier format as members. Upload a replacement ZIP to edit the files. Existing skills remain usable. Imports do not run scripts. Limits are 1 MiB of skill files per member and 128 files per skill. Skill names must be unique within a member.
- **Databases:** configure MySQL host, port, database, read-only username, password credential reference, TLS, row limit and timeout. Save the member and reopen the connection to browse **Approved tables**. Search or page through physical tables, select a table, then check up to 200 columns. The owner-only picker reads metadata through the saved connection. Each table needs an explicit column list. An empty list of tables allows connection tests only. Under **SQL examples**, add questions, SELECT statements with `?` placeholders, positional parameter descriptions, and business definitions or units.

Ask the assigned member to call `team_database` with `catalog`, `test`, or `schema` to inspect its own connections. Queries require an `explain` call with the same SQL and JSON parameter values before `query`; review cost and indexes before proceeding. The tool uses prepared statements, a read-only transaction, MySQL execution time limits, and at most 1,000 result rows. Every column in the projection, filters, joins, groups, and sorting must be approved. Qualify columns in joins and use explicit `ON`; use approved columns or expressions in sorting. `COUNT(*)` is supported. The tool rejects `SELECT *`, writes, subqueries, CTEs, UNION, and functions outside its read-only list. Schema inspection returns only approved columns and indexes composed entirely of those columns. A result at the configured cap may be truncated. MySQL 5.7+ is required; MariaDB and other database engines are not supported.

For example, approve `orders` only after verifying its actual columns, then configure a question such as “Total paid amount during a business-date range” with `SELECT SUM(paid_amount) AS total_amount FROM orders WHERE business_time >= ? AND business_time < ?`. Describe both date parameters and the stored amount unit; this is a template, not a claim about your database schema. Connection tests and query errors appear in the member's tool results; the editor does not connect to a database while saving.

### Server installation

Build the plugin locally with the commands above, then create the distributable archive:

```sh
pnpm --dir plugins/xlx-agent-team pack
```

Copy `plugins/xlx-agent-team/dsh-xlx-agent-team-0.1.0.tgz` to the server. In the directory containing that archive, use the server's DSH installation and the profile that serves its Web application:

```sh
dsh plugin --profile web add ./dsh-xlx-agent-team-0.1.0.tgz
```

The archive contains the compiled Host and browser code, patch and translations. The server needs the same DSH version and a Web profile with the built-in subagent, spawn provider, team and model services. Credentials remain in the server's existing model-provider configuration. The archive does not contain local member settings or credentials.

The profile also needs the built-in storage-domain, skills and credential services. Dependency installation needs access to the configured package registry. Install any configured local MCP executables on the server and configure credential references there.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

[cordis.patch.yml](cordis.patch.yml) inserts the `xlx-agent-team` entry. Its `enabled` and `members` settings are live configuration references. `members` is a dictionary keyed by member id; each value contains `name`, `instructions`, `enabled`, `provider` and `model`. Empty provider and model strings select inheritance; an explicit route requires both values.

[src/index.ts](src/index.ts) registers discovery, delegation and lead guidance through Cordis effects. It validates the selected model before starting an activation, rechecks member settings after asynchronous preparation, and uses the existing child lifecycle and Session logging. The first delegation enables the Session's shared team task board. The [client controller](src/client/controller.ts) uses revision-checked configuration writes and waits for its requests during disposal.

[Member runtime](src/member-runtime.ts) stores accepted capability configuration in the `xlx_team_capabilities` storage domain before child creation. The child id selects that immutable admission snapshot during creation and cold resume. Back up this domain with the Session store. Child-owned plugins mount MCP transports, temporary skill directories and database tools; child disposal closes transports, removes resources and drains database operations. [Database validation](src/database.ts) checks SQL using node-sql-parser and binds values with mysql2.

</details>

<a id="model-experience"></a>
## Model Experience

The lead receives `team_members` and `team_delegate` when the plugin and at least one member are enabled. The roster tool exposes responsibilities and model routes. Delegation includes the saved role and assigned task in the child's logged initial message, and returns its runtime name. The lead can use existing messaging and task-board tools, then integrate completion notifications. Configured-member delegation is available only to the root agent.

<a id="known-limitations"></a>
## Known Limitations

Automatic task division depends on the lead model's decisions. Members use the existing subagent concurrency and depth limits. Tasks already started retain their accepted role and model; editing, disabling or deleting a definition affects future delegations. Disabling this plugin does not cancel running children or clear the Session's team board. Role instructions are guidance, not a filesystem permission policy. The settings UI is for Web; it does not add a desktop settings page.

Accepted capability snapshots also survive member edits and removal; credentials resolve again at each database operation or MCP connection. Keep the plugin installed to restore these capabilities on cold resume. Scope isolation controls discovery and registration, not operating-system isolation: configured processes and scripts use the server's existing execution permissions. Use database grants and the normal preset/sandbox configuration for access control.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

The bundle is maintained under `plugins/` and builds with the repository's shared client bundler. The Host configuration schema must survive JSON serialization for browser form validation. Reuse the native subagent runtime, model catalog, controls and localization dictionaries when extending it.

</details>
