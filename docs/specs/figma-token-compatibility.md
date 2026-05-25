# Figma Token Compatibility

Source Figma file metadata is intentionally omitted from the public repository.

Current code source: `packages/console/src/styles.css`.

## Current Shape

Figma has four local variable collections:

- `☀️  Mode`: 137 variables, modes `☀️  Light` and `🌑 Dark`. This is the best runtime source for semantic theme colors.
- `Primitives & Theme`: 420 variables. This owns primitive palettes and base aliases.
- `💨 Tailwind`: 206 sizing, spacing, breakpoint, opacity, and typography variables.
- `📱 Responsive`: 11 responsive-layout variables.

The console app currently has:

- 93 variables in `:root`;
- 49 overrides in `.dark`;
- 23 Tailwind v4 `@theme inline` aliases;
- several manually maintained component-token groups: `--auth-*`, `--color-feedback-*`, `--toast-*`, and `--tag-*`.

## Core Theme Audit

Values below compare the current console CSS against Figma `☀️  Mode/theme/*`. Code OKLCH values are shown as approximate hex for readability.

| CSS variable             | Current light | Figma light | Current dark | Figma dark  | Status        |
| ------------------------ | ------------- | ----------- | ------------ | ----------- | ------------- |
| `--background`           | `#FAFAFB`     | `#FAFAFA`   | `#0E141D`    | `#090A0B`   | mismatch      |
| `--foreground`           | `#1F2227`     | `#121417`   | `#F6F5F2`    | `#F4F4F6`   | mismatch      |
| `--card`                 | `#FFFFFF`     | `#FFFFFF`   | `#171D26`    | `#121417`   | dark mismatch |
| `--card-foreground`      | `#1F2227`     | `#121417`   | `#F6F5F2`    | `#E6E8EA`   | mismatch      |
| `--popover`              | `#FFFFFF`     | `#FFFFFF`   | `#171D26`    | `#24282C`   | dark mismatch |
| `--popover-foreground`   | `#1F2227`     | `#121417`   | `#F6F5F2`    | `#F4F4F6`   | mismatch      |
| `--primary`              | `#2B3645`     | `#121417`   | `#83B7E2`    | `#E6E8EA`   | mismatch      |
| `--primary-foreground`   | `#F9FAFB`     | `#FFFFFF`   | `#131921`    | `#121417`   | mismatch      |
| `--secondary`            | `#F2F3F5`     | `#BDD92E`   | `#252C35`    | `#A7C11F`   | mismatch      |
| `--secondary-foreground` | `#31363D`     | `#121417`   | `#F6F5F2`    | `#FFFFFF`   | mismatch      |
| `--muted`                | `#F4F6F8`     | `#E6E8EA`   | `#232932`    | `#121417`   | mismatch      |
| `--muted-foreground`     | `#5F646A`     | `#9CA4AB`   | `#9EA5AF`    | `#737E87`   | mismatch      |
| `--accent`               | `#E8EBEE`     | `#E8F8A0`   | `#42361F`    | `#282E02`   | mismatch      |
| `--accent-foreground`    | `#272C32`     | `#282E02`   | `#F6F5F2`    | `#E8F8A0`   | mismatch      |
| `--destructive`          | `#EC3A32`     | `#C0412C`   | `#F75E54`    | `#D75B42`   | mismatch      |
| `--border`               | `#DDDFE1`     | `#4D565E1A` | `#2C3138`    | `#4D565E80` | mismatch      |
| `--input`                | `#DDDFE1`     | `#E6E8EA`   | `#2C3138`    | `#24282C`   | mismatch      |
| `--ring`                 | `#454E59`     | `#BDD92E`   | `#83B7E2`    | `#BDD92E`   | mismatch      |

## Recommended Remap

Use Figma semantic variables as the canonical source for shadcn/Tailwind CSS variables:

| Figma variable               | CSS variable             | Tailwind usage                       |
| ---------------------------- | ------------------------ | ------------------------------------ |
| `theme/background`           | `--background`           | `bg-background`                      |
| `theme/foreground`           | `--foreground`           | `text-foreground`                    |
| `theme/card`                 | `--card`                 | `bg-card`                            |
| `theme/card-foreground`      | `--card-foreground`      | `text-card-foreground`               |
| `theme/popover`              | `--popover`              | `bg-popover`                         |
| `theme/popover-foreground`   | `--popover-foreground`   | `text-popover-foreground`            |
| `theme/primary`              | `--primary`              | `bg-primary`, `text-primary`         |
| `theme/primary-foreground`   | `--primary-foreground`   | `text-primary-foreground`            |
| `theme/secondary`            | `--secondary`            | `bg-secondary`, `text-secondary`     |
| `theme/secondary-foreground` | `--secondary-foreground` | `text-secondary-foreground`          |
| `theme/muted`                | `--muted`                | `bg-muted`                           |
| `theme/muted-foreground`     | `--muted-foreground`     | `text-muted-foreground`              |
| `theme/accent`               | `--accent`               | `bg-accent`                          |
| `theme/accent-foreground`    | `--accent-foreground`    | `text-accent-foreground`             |
| `theme/destructive`          | `--destructive`          | `bg-destructive`, `text-destructive` |
| `theme/border`               | `--border`               | `border-border`                      |
| `theme/input`                | `--input`                | `border-input`                       |
| `theme/ring`                 | `--ring`                 | `ring-ring`                          |

Additional Figma variables should be exposed to code because they are already present in the design but missing or not wired in CSS:

| Figma variable                      | Proposed CSS variable         | Purpose                         |
| ----------------------------------- | ----------------------------- | ------------------------------- |
| `theme/info`                        | `--info`                      | blue informational/action color |
| `theme/success`                     | `--success`                   | success states                  |
| `theme/warning`                     | `--warning`                   | warning states                  |
| `theme/sidebar`                     | `--sidebar`                   | sidebar surface                 |
| `theme/sidebar-foreground`          | `--sidebar-foreground`        | sidebar text                    |
| `theme/sidebar-accent`              | `--sidebar-accent`            | active sidebar item             |
| `theme/sidebar-accent-foreground`   | `--sidebar-accent-foreground` | active sidebar item text        |
| `theme/sidebar-border`              | `--sidebar-border`            | sidebar dividers                |
| `theme/chart-1` ... `theme/chart-5` | `--chart-1` ... `--chart-5`   | charts                          |

## Important Semantic Decision

In Figma, `theme/primary` is neutral text/ink (`#121417` in light), not blue. The current code uses blue in several places that are named `primary`, especially auth and tag tokens. Those should not stay mapped to `--primary` if we want compatibility.

Recommended migration:

- map blue action/info tokens to `theme/info`;
- map green status tokens to `theme/success`;
- map yellow status tokens to `theme/warning`;
- map red status tokens to `theme/destructive`;
- reserve `theme/primary` for the neutral primary text/ink token from Figma.

## Next Implementation Step

Do not replace component colors directly in React components. First add generated CSS output from the remap:

```txt
design-tokens/compartment-token-map.json
  -> packages/console/src/styles/tokens.generated.css
  -> imported by packages/console/src/styles.css
```

Then replace hardcoded colors gradually:

- `#3480c8` -> `var(--info)` or a component token derived from `--info`;
- `#28a23c` -> `var(--success)`;
- `#d0aa25` -> `var(--warning)`;
- `#c0412c` -> `var(--destructive)`;
- `#4d565e1a` -> `var(--border)`;
- `slate-*` and one-off OKLCH values -> semantic CSS variables.
