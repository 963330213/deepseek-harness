---
kind: upgrade-guide
description: "XLX Auth 替代 Web 配置档案中的独立 OAuth 插件。"
---

# OAuth 合并到 XLX Auth

[English](guide.md) | 中文

## 变更

XLX Auth 提供原独立 OAuth 插件的设置、授权路由和入站 `/mcp` 端点。原有地址、已保存配置和已注册客户端继续有效。

## 迁移

1. 如果 Web 配置档案的 `cordis.patch.yml` 设置了 `xlx-oauth.config.resource`，将值移到 `xlx-auth.config.mcpResource`，并移除原 `xlx-oauth` 条目。后台已保存的设置优先。
2. 如已安装独立包，执行 `dsh plugin --profile web remove dsh-xlx-oauth`。升级 `dsh-xlx-auth` 后重启 Web。
3. 以管理员身份打开「用户权限 → OAuth 授权 → 配置 MCP」，确认资源地址。重启后重新授权 MCP 客户端以获取新令牌。
