---
title: 'compartment system'
description: 'Generated help output for compartment system.'
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
Usage: compartment system [options] [command]

Kubernetes platform operator commands

Options:
  -h, --help                      display help for command

Commands:
  domain                          System-domain lifecycle for a Kubernetes
                                  install
  issue-password-reset [options]  Issue a private one-time password reset
  status [options]                Show Helm release status and platform workload
                                  readiness
  restart [options]               Restart platform workloads and wait for their
                                  rollout
  update [options]                Verify images, update the Kubernetes platform,
                                  and run database migrations
  diagnose [options]              Create a redacted managed-VM support bundle
  reset [options]                 Destroy a Compartment-provisioned cluster and
                                  its owned host state
  help [command]                  display help for command
```

## Related Commands

- [compartment system domain](/reference/generated/cli/system/domain/)
- [compartment system issue-password-reset](/reference/generated/cli/system/issue-password-reset/)
- [compartment system status](/reference/generated/cli/system/status/)
- [compartment system restart](/reference/generated/cli/system/restart/)
- [compartment system update](/reference/generated/cli/system/update/)
- [compartment system diagnose](/reference/generated/cli/system/diagnose/)
- [compartment system reset](/reference/generated/cli/system/reset/)
