# DSH project account access

English | [中文](README.zh.md)

The plugin provides sign-in and authorization through the existing DSH Web server. Administrators open **User access** in the sidebar to manage users, roles, account status, and passwords. The account database is separate from application databases and DSH Session storage.

Web administration requires the `admin` role. The plugin also provides OAuth authorization for MCP clients.

## Install and configure

The plugin uses `connection.registerBrowserAuthentication` and requires a DSH build from this repository. Run these commands from the repository root when installing from source.

```powershell
pnpm --dir plugins/xlx-auth install --ignore-workspace --frozen-lockfile
pnpm dsh plugin --profile web add ./plugins/xlx-auth
```

Specify a configuration file in the Web profile's `cordis.patch.yml` or through `DSH_XLX_AUTH_CONFIG`. The file takes `database` (absolute SQLite path), `bootstrapUser` (initial administrator login), and `workspacesDirectory` (absolute root for user workspaces). Before creating an empty database, set `DSH_XLX_BOOTSTRAP_PASSWORD` to an administrator password of 6 to 256 characters. An existing account database takes precedence. Both the browser and server measure password length in UTF-16 code units. Restrict the configuration and database files to the system account running DSH.

```yaml
- id: xlx-auth
  config:
    file: C:/private/dsh-project-auth.json
```

The plugin bundle sets Connection's `authentication` to `plugin`, disabling the built-in launch token and `/connect` authentication. Project APIs refuse access when the account plugin is absent, fails to start, or unloads. Restore Connection's native authentication when uninstalling the plugin. This version requires the Web profile configuration and continues to use existing SQLite accounts and passwords.

## OAuth authorization

An administrator opens **User access → OAuth authorization → Configure MCP**, enables MCP, and enters the full resource URL, for example `http://localhost:3080/mcp`. Use HTTPS for non-loopback addresses and preserve the resource Host in the reverse proxy. The Web profile's `cordis.patch.yml` can set `xlx-auth.config.mcpResource` as the initial address. Settings saved by an administrator take precedence.

The MCP client must support dynamic registration, authorization codes, and S256 PKCE. Use a loopback callback with an explicit port and a hostname distinct from the DSH sign-in page, for example `http://127.0.0.1:8787/callback`.

Access tokens last one hour. Restarting DSH Web, disabling MCP, or changing the resource URL revokes current tokens and requires clients to authorize again. The plugin stores dynamically registered client IDs by resource URL in a SQLite file beside the account database.

## Users and roles

The `member` role can use MCP. Ordinary users start OAuth from an MCP client and sign in from a valid authorization request. The first authorized call provisions the user's workspace. MCP exposes `dsh_create_session`, `dsh_list_sessions`, `dsh_send_message`, and `dsh_read_replies`. Workspace and Session ownership restrict every account's calls. Child Sessions inherit the parent Session's user ownership.

The `admin` role grants Web administration access to project settings, workspaces, and Sessions. An account can authorize MCP when any assigned role grants **Use MCP**. Changing that permission for a user or role revokes the affected logins and closes authenticated administration connections. The project requires at least one enabled administrator. Leave the password field empty when editing a user to retain the existing password.

After installing the agent team plugin, open **User access → Manage roles**, edit a role, and select the available delegates under **Authorized agents**. Each Session uses the union of the roles of its owner. Web Sessions without a user owner use the `admin` grants. Ordinary roles start without member grants, while `admin` initially grants every member. To choose specific members for `admin`, clear **Authorize all agents**.

The settings page shows user and role totals. **Manage users** and **Manage roles** open the corresponding dialogs. Both lists support prefix search, reset, and server-side pages of 10 entries. The user list also supports status filters. One dialog handles creation and editing and preserves filters and the current page upon returning to the list. Role selection is paginated and merges chosen roles with the current page, preserving selections and allowing them to be cleared across pages. Queries use name indexes and cursor pagination and batch-load account roles for the displayed page. The lists become scrollable cards in narrow windows.

## Current limitations

Accounts share a DSH process and an operating system identity. The deployment controls the tool sandbox and file-access restrictions. Model work already running continues after sign-out.

## Verify

After enabling MCP, start OAuth from a client with an ordinary account that has **Use MCP**. Sign in and approve access. Call `dsh_list_sessions` to verify that the client displays only that account's Sessions. Verify that direct Web administration sign-in refuses the same account.
