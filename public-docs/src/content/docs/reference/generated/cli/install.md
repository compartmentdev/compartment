---
title: 'compartment install'
description: 'Generated help output for compartment install.'
---

This page is generated from the current shipped `compartment` help output.

Related guides:

- [Install Compartment](/quickstart/install-compartment/)
- [Install Modes](/install-operate/install-modes/)
- [Install Domain](/install-operate/install-domain/)
- [System Operations](/install-operate/system-operations/)

## Help Output

```text
Usage: compartment install [options]

Options:
  --dev                       Install against the local repo dev API
  --email <email>             First admin email
  --organization <name>       First organization name
  --organization-slug <slug>
  --remote <name>             Remote name for --dev session persistence
  --base-domain <domain>
  --managed-domain            Allocate a managed install domain through the
                              broker
  --broker-url <url>
  --local-runtime             Install the full self-hosted Docker runtime with
                              local browser hosts
  --image-source <source>     registry or local
  --public-http-port <port>
  --public-https-port <port>
  --version <version>         runtime tag; registry installs must match the
                              packaged CLI node-agent
  --output <format>           text or json (default: "text")
  -h, --help                  display help for command
```
