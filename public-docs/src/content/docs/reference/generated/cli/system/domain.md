---
title: 'compartment system domain'
description: 'Generated help output for compartment system domain.'
---

This page is generated from the current shipped `compartment` help output.

Related guides:

- [Install Compartment](/quickstart/install-compartment/)
- [Install Modes](/install-operate/install-modes/)
- [Install Domain](/install-operate/install-domain/)
- [System Operations](/install-operate/system-operations/)
- [Operate a Managed VM](/guides/operate-managed-vm/)

## Help Output

```text
Usage: compartment system domain [options] [command]

System-domain lifecycle for a Kubernetes install

Options:
  -h, --help               display help for command

Commands:
  status [options]         Refresh and show system-domain status
  set [options]            Stage a custom system domain and print required DNS
                           records
  verify [options]         Verify the pending domain
  activate [options]       Re-verify, roll out, and activate the pending domain
  reset-managed [options]  Restore the managed domain retained by the
                           installation
  help [command]           display help for command
```

## Related Commands

- [compartment system domain status](/reference/generated/cli/system/domain/status/)
- [compartment system domain set](/reference/generated/cli/system/domain/set/)
- [compartment system domain verify](/reference/generated/cli/system/domain/verify/)
- [compartment system domain activate](/reference/generated/cli/system/domain/activate/)
- [compartment system domain reset-managed](/reference/generated/cli/system/domain/reset-managed/)
