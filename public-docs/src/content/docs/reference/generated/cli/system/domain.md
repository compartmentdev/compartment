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

## Help Output

```text
Usage: compartment system domain [options] [command]

System domain commands

Options:
  -h, --help               display help for command

Commands:
  status [options]
  set [options]            Stage a whole-install custom domain and print
                           required TXT and ingress records
  attach-cert [options]
  verify [options]         Verify ownership TXT plus direct install binding;
                           proxied or CDN-masked DNS is not accepted
  activate [options]       Re-verify the pending domain, apply runtime, and
                           finalize activation
  reset-managed [options]
  help [command]           display help for command
```

## Related Commands

- [compartment system domain status](/reference/generated/cli/system/domain/status/)
- [compartment system domain set](/reference/generated/cli/system/domain/set/)
- [compartment system domain attach-cert](/reference/generated/cli/system/domain/attach-cert/)
- [compartment system domain verify](/reference/generated/cli/system/domain/verify/)
- [compartment system domain activate](/reference/generated/cli/system/domain/activate/)
- [compartment system domain reset-managed](/reference/generated/cli/system/domain/reset-managed/)
