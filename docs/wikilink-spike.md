# Wikilink syntax spike

Proves the maintained `@flowershow/remark-wiki-link` plugin handles the real
staged Shared body-wikilink syntax with minimal project-owned code. It replaces
the unfinished bespoke compiler: no project-owned Markdown compiler, HTML
renderer, sanitizer, compatibility report, or link resolver remains.

## Boundary

```text
private vault
  -> validate publication.manifest.yaml (scripts/stage-content.mjs)
  -> copy only allowlisted content into isolated staging
  -> prove wikilink syntax (scripts/wikilink-spike.mjs)
```

The spike accepts only `--content-dir` (an isolated staged tree). Vault inputs
and staged symlinks are rejected. It discovers staged Markdown, configures
`format: "shortestPossible"` with the staged file list, maps each file to its
route through `permalinks`, and processes every staged file without reading
the original vault. Frontmatter wikilinks are out of scope for this spike.

## Stage and spike

```bash
node scripts/stage-content.mjs \
  --kb-root <vault-root> \
  --content-dir <staging>/content \
  --identity-file <staging>/site-identity.json

node scripts/wikilink-spike.mjs --content-dir <staging>/content
```

Keep `<staging>` outside the repository. Do not commit staged content.

Real Shared projection aggregates (53 selected Markdown files plus the
synthetic landing page, 54 processed, exit 0):

- 42 body-text wikilinks processed, 0 failures.
- 1 resolved to an internal route; 41 carry the plugin `internal new` class.
- 195 frontmatter occurrences skipped by design; 29 code occurrences literal.

Exact shortest-form matching explains the unresolved count: vault labels such
as `[[Life Planning]]` rarely equal staged file paths. Fuzzy title, route,
and ambiguity rules stay a small future adapter only if the reader proves
they are needed.

## Bounded conclusion

The maintained plugin owns body-wikilink syntax: `[[target]]`,
`[[target|alias]]`, `[[target#heading]]`, `[[target#heading|alias]]`, with
missing targets marked `internal new` and code kept literal.
Repository-specific title, route, and ambiguity rules remain a small future
adapter only if the reader proves they are needed. Fumadocs integration is
deferred to the vertical reader slice rather than introduced here.
