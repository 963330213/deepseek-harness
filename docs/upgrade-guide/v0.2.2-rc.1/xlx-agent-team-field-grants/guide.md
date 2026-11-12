---
kind: upgrade-guide
description: "The XLX agent team plugin requires explicit database column grants and accepts only ZIP uploads for skills."
---

# XLX agent team: column grants and ZIP uploads

English | [中文](guide.zh.md)

## Change

The optional XLX agent team plugin requires both a physical table name and an explicit column list to query that table. Connections and table names still load from older settings and saved member snapshots. A table without column grants cannot be queried or inspected. SQL examples must use the same grants, and subqueries are no longer supported.

New skill uploads require a ZIP. Installed skills and their files remain available.

## Migration

1. In **Agent team → Edit agent → Databases**, edit each connection that previously listed tables. Under **Approved tables**, select the table and check the columns needed by queries and SQL examples. For direct profile edits, add a `columns` dictionary keyed by the physical names in `tables` to each member's `capabilities.databases` entry.
2. Update SQL examples to use only approved columns, explicit join conditions and no subqueries. Save the member and delegate a new task to verify `team_database` reports the approved fields in `catalog`. Existing member snapshots retain the original configuration; use a new delegation to apply the updated grants.
3. For new or replacement skills, put the `SKILL.md` and any resources in a ZIP and upload it in **Private skills**.
