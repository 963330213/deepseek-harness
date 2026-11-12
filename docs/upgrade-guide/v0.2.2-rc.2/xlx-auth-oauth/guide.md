---
kind: upgrade-guide
description: "XLX Auth replaces the separate OAuth plugin for Web profiles."
---

# OAuth moves into XLX Auth

English | [中文](guide.zh.md)

## Change

XLX Auth provides the OAuth settings, authorization routes and inbound `/mcp` endpoint previously provided by the separate OAuth plugin. The existing URLs, saved settings and registered clients remain valid.

## Migration

1. If the Web profile's `cordis.patch.yml` defines `xlx-oauth.config.resource`, move its value to `xlx-auth.config.mcpResource`. Remove the old `xlx-oauth` entry. Settings saved from the Web app take precedence.
2. If installed, remove the separate package with `dsh plugin --profile web remove dsh-xlx-oauth`. Upgrade `dsh-xlx-auth` and restart Web.
3. As an administrator, open **User permissions → OAuth authorization → Configure MCP** and confirm the resource URL. Reauthorize the MCP client to replace its access token after the restart.
