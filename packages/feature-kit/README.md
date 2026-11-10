# @smw/feature-kit

The feature system: how a feature is declared, the registry of every feature, and the resolver that answers "is this feature on for this school?"

## What goes here

- `defineFeature()`: key, name, stage (alpha, beta, ga), required features, menu items, permissions, settings schema
- Registry that lists every feature package's manifest
- Resolver: school status, then per-school switch, then plan, then required features (spec §11)
- Guards used by the sidebar, the route layouts and every service call

## When

Phase 0.
