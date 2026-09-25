# 05 — Opt-in Personal and Shared Web Projection switcher

**What to build:** A reader can choose Personal or Shared at the top of the sidebar when the Web Projection owner explicitly advertises that destination, without merging sites or access policies.

**Blocked by:** 01 — Desktop reader shell and published file tree.

**Status:** ready-for-agent

- [ ] Owners can optionally declare display names and secure HTTPS destinations through the publication configuration; existing declarations without destinations still build and show the current projection correctly.
- [ ] Staging rejects malformed, duplicate, or conflicting destinations and emits only the explicitly declared public-safe destinations; it never auto-discovers another Knowledge Base or broadens the Allowlist.
- [ ] The switcher shows the current Web Projection and only configured destinations. It has no Add vault or team-management action.
- [ ] Selecting a destination follows a normal link to its separate origin; no local content switch, shared offline state, shared install identity, or Access bypass is implied.
- [ ] Personal and Shared are the initial consumer opt-ins; the generic Publisher does not hard-code their hostnames. A one-projection fixture stays valid.
- [ ] Focused publication-contract checks and a synthetic static-export browser journey verify absent/valid/invalid configuration, rendered choices, target URLs, and keyboard operation. Update the publication contract documentation with the optional field.
