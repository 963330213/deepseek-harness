---
kind: upgrade-guide
description: "XLX Auth now requires explicit teammate grants for regular roles."
---

# Team delegation follows XLX role grants

English | [中文](guide.zh.md)

## Change

Previously, sessions could delegate to any enabled configured teammate. With XLX Auth installed, regular roles start with no teammate grants. The built-in `admin` role starts with all teammates and can be restricted to a selection. An older child without a stored member identifier needs a new delegation in a restricted session.

## Migration

1. Back up the XLX Auth SQLite database and upgrade `dsh-xlx-auth` and `dsh-xlx-agent-team` together. XLX Auth adds the role grants column on startup.
2. In **User permissions → Manage roles**, edit each role and select its members under **Authorized teammates**. For `admin`, clear **Authorize all teammates** to select specific members.
3. In a conversation with the affected role, check that the lead discovers only the selected enabled members.
