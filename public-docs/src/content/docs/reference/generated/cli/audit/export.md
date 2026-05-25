---
title: 'compartment audit export'
description: 'Generated help output for compartment audit export.'
---

This page is generated from the current shipped `compartment` help output.

Related guides:

- [Access, Organizations, Users, and Roles](/manage-access/access-organizations-users-and-roles/)
- [Grant Access to Users and Groups](/manage-access/grant-access-to-users-and-groups/)
- [Roles and Permissions](/manage-access/roles-and-permissions/)
- [Audit Logs](/manage-access/audit-logs/)
- [Troubleshoot Access](/manage-access/troubleshoot-access/)

## Help Output

```text
Usage: compartment audit export [options]

Options:
  --from <time>          include events at or after this ISO time
  --to <time>            include events at or before this ISO time
  --event <type>         event type
  --actor <actor>        actor principal id or email
  --target-type <type>   target type
  --project <projectId>  project id
  --format <format>      ndjson or csv (default: "ndjson")
  --output <path>        output file path, or - for stdout (default: "-")
  --remote <name>
  -h, --help             display help for command
```
