---
title: Custom Domains for Apps
description: Add stable public hosts for a deployed app without replacing the canonical Compartment route.
---

Use app custom domains when you want a deployed app to answer on an exact host that your users already know.

Typical cases:

- a stable internal hostname such as `support.customer.example`;
- a friendlier URL for a business app than the generated Compartment route;
- moving a user-facing host to Compartment while keeping the install base domain as the fallback path.

Custom domains add an alias for an existing public route. They do not replace the canonical Compartment host under the install base domain.

Main commands:

```bash
compartment domain add <host>
compartment domain list
compartment domain show <host>
compartment domain verify <host>
compartment domain remove <host>
```

Custom-domain verification checks two things:

- ownership via the `_compartment-domain.<customHost>` TXT record;
- routing DNS for the current runtime host plan.

`compartment domain list` and `compartment domain show` keep pointing at the last successfully published canonical app route. A queued or running redeploy does not move the custom domain early; the canonical route host changes there only after the new deployment completes successfully.

Custom domains are supported only when the active install can terminate TLS locally for the custom host.

Automation note: custom-domain create, verify, list, and delete flows return only the documented fields. Build automation against the published contract instead of depending on extra response properties.

Next steps:

- Review the ingress and TLS choices in [Install Compartment](/quickstart/install-compartment/#install-the-platform-on-kubernetes).
- Read [Projects and App URLs](/deploy-apps/projects-and-app-urls/).
- Browse the [generated custom-domain command reference](/reference/generated/cli/domain/).
