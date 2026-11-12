---
kind: upgrade-guide
description: "XLX Auth requires the admin role for Web access."
---

# XLX Auth Web access requires the admin role

English | [中文](guide.zh.md)

## Change

Previously, a role granting DSH access or account management could allow Web sign-in. The Web app now requires the built-in `admin` role. Regular users with **Use MCP** sign in during OAuth authorization from their MCP client.

## Migration

1. Before upgrading, use **User permissions → Manage users** to assign the `admin` role to at least one enabled account and to every account that needs Web access. Startup requires at least one enabled `admin` account.
2. After restarting Web, confirm that an `admin` account can open the app and that a regular user can authorize their MCP client. If the previous profile used the separate OAuth plugin, follow the [OAuth migration guide](../xlx-auth-oauth/guide.md).
