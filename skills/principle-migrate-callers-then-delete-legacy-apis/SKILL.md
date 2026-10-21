---
name: principle-migrate-callers-then-delete-legacy-apis
description: "Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers."
disable-model-invocation: true
---

# Migrate Callers Then Delete Legacy APIs

When a new API is the right design, migrate every caller and remove the old API in the same wave instead of preserving a compatibility layer.

- Do not keep a legacy API path only because internal callers still use it
- Inventory every caller, including tests and docs, migrate them, and delete the old API immediately. No shims, aliases, or parallel old-and-new paths
- Update tests to assert the new contract, and delete tests that only protect pre-refactor implementation details

**When this applies:**
- No external users depend on backward compatibility
- The project can absorb coordinated breaking changes
- The new API is part of a simplification or refactor initiative
