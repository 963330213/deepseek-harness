---
kind: upgrade-guide
description: "XLX Auth 后台要求 admin 角色。"
---

# XLX Auth 后台要求 admin 角色

[English](guide.md) | 中文

## 变更

此前，拥有使用 DSH 或管理账号权限的角色可登录 Web。现在后台要求内置 `admin` 角色。具有「使用 MCP」权限的普通用户在 MCP 客户端发起的 OAuth 授权中登录。

## 迁移

1. 升级前，在「用户权限 → 管理用户」中为至少一个已启用的账号以及所有需要后台访问的账号分配 `admin` 角色。启动时要求至少一个已启用的 `admin` 账号。
2. 重启 Web 后，确认 `admin` 账号能进入后台，普通用户能授权 MCP 客户端。如果原配置档案使用独立 OAuth 插件，按 [OAuth 迁移指南](../xlx-auth-oauth/guide.zh.md) 处理。
