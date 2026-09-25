# Publication Manifest contract

A Publication Manifest is a small YAML file that opts a Knowledge Base into
web publication. It is the single interface between a content repository and
the Knowledge Web Publisher.

## Location

`publication.manifest.yaml` in the Knowledge Base root. The Publisher looks
here by default; a custom path can be passed with `--manifest`.

## Fields

| Field               | Required | Meaning                                                                                                           |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `title`             | yes      | Human-readable site title, shown in the browser and generated pages.                                              |
| `canonicalHostname` | yes      | Canonical DNS hostname of the Web Projection (no scheme, port, or path).                                          |
| `select`            | yes      | Explicit allowlist: one or more content roots or files, relative to the Knowledge Base root.                      |
| `navigation`        | no       | Optional ordered presentation list: a subset of the allowlist that sets the visible reader roots and their order. |

### Example

```yaml
title: Example Garden
canonicalHostname: garden.example.com
select:
  - notes
  - trip-log
  - about.md
```

### Example with explicit navigation

```yaml
title: Example Garden
canonicalHostname: garden.example.com
select:
  - notes
  - trip-log
  - attachments/handouts
  - about.md
navigation:
  - about.md
  - notes
  - trip-log
```

Here the reader shows three roots in the listed order. The asset-heavy
`attachments/handouts` selection stays staged but has no navigation root
because it names no Markdown page worth browsing.

## Semantics

- **The allowlist is the publication authority.** Only the listed roots and
  files are copied into the isolated build content tree. Everything else in
  the repository — instructions, skills, configuration, private material —
  stays out of the generated site and the final runtime image, even though
  the private repository is the Docker build context.
- Selections are relative paths. Directories are copied recursively; files
  are copied individually.
- Selected Markdown is preserved **byte-for-byte**: frontmatter, first-H1
  titles, body text, and wikilinks are carried into the build tree untouched.
  The Publisher never rewrites canonical files and never writes into the
  Knowledge Base.
- **Navigation is presentation metadata only.** It names the visible reader
  roots and their order. It cannot broaden `select`, publish an unselected
  path, or admit a non-Markdown page. Anything outside the allowlist never
  enters staging, generated metadata, or the final image, no matter what
  `navigation` lists.
- When `navigation` is absent, staging derives visible roots from `select`
  in manifest order: it keeps Markdown files and directories containing at
  least one Markdown page, and ignores selections with no Markdown pages.
  Existing manifests without `navigation` therefore stay valid, and
  asset-only selections never become navigation roots.
- When `navigation` is present, each entry names one allowlisted Markdown
  file or one allowlisted directory with at least one Markdown page. Root
  order follows the listed order exactly.
- A selected directory does not need an authored `index.md`. The reader
  serves a virtual static folder page for every staged folder containing
  Markdown pages. An authored `index.md` owns its folder route and
  introduction; a virtual page supplies a humanized title and child
  navigation.
- `title` and `canonicalHostname` plus resolved `navigation` roots are
  emitted as deterministic generated site metadata JSON outside the staged
  content tree (default `site-identity.json`), so each Web Projection
  carries its own identity without modifying a tracked configuration file.
  See ADR-0002 for the reader replacement decision and
  ADR-0003 for the generic reader decision.

## Validation rules

The build **fails before producing any output** when the manifest or any
selection is invalid. All violations are reported in one pass:

| Rule                                                                                                         | Example                                              |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Manifest must exist and be a YAML mapping                                                                    | missing file, invalid YAML                           |
| `title` required, non-empty                                                                                  | `title:` empty                                       |
| `canonicalHostname` required, valid DNS hostname with at least one dot; no scheme, port, path, or whitespace | `canonicalHostname: https://garden.example.com`      |
| `select` required with at least one entry                                                                    | missing `select`, `select: []`                       |
| Selections must be non-empty strings                                                                         | `- ""`                                               |
| Selections must be relative                                                                                  | `- /etc/passwd`, `- C:\notes`                        |
| Selections must not traverse above the root                                                                  | `- ../secret`                                        |
| Selections must not select the root or empty paths                                                           | `- .`, `- ./`                                        |
| Selections must exist                                                                                        | `- missing.md`                                       |
| Selections must resolve inside the Knowledge Base root                                                       | a symlink pointing outside the root                  |
| Symlinks encountered inside selected content must resolve within the allowlisted content                     | a symlink in `notes/` pointing at an unselected file |
| The Git directory can never be selected                                                                      | `- .git`                                             |
| The build content directory must not be inside the Knowledge Base root                                       | misconfigured `--content-dir`                        |
| `navigation`, when present, must be a non-empty list of non-empty strings                                    | `navigation: notes`, `navigation: []`, `- ""`        |
| Navigation paths use the same safety rules as `select`                                                       | `- /etc/passwd`, `- ../secret`, `- .git`             |
| Navigation paths must not repeat after normalization                                                         | `- notes` and `- notes/` together                    |
| Every navigation entry must be covered by `select`                                                           | `navigation: [diary]` with `select: [notes]`         |
| An explicitly named navigation file must be a Markdown file                                                  | `navigation: [logo.png]`                             |
| A navigation directory must contain at least one staged Markdown page                                        | `navigation: [assets]` with only images inside       |
| A navigation entry must exist in the staged tree                                                             | `navigation: [notes/missing.md]`                     |

Navigation normalization trims surrounding whitespace, strips leading
`./` segments, collapses repeated slashes, and removes trailing slashes,
exactly like `select` normalization. A navigation file entry keeps its
`.md` suffix in the manifest; generated metadata records the public path
with a `kind` marker instead of relying on the suffix.

Symlinks that stay inside the allowlisted content are dereferenced during
staging, so the isolated build tree contains only real files. Any symlink that
would escape the allowlist aborts the build before partial output exists.

## Generated landing page

When the allowlisted content contains no root `index.md`, the Publisher
generates a synthetic landing page **only inside the build tree** (never in
the Knowledge Base). It carries the manifest title and links to each
top-level selection. When a selected root `index.md` exists, it is used
verbatim and nothing is generated.

## Generated site identity

A successful stage writes `site-identity.json` outside the staged content
tree (default `<publisher>/site-identity.json`, override with
`--identity-file`). The file is deterministic JSON with stable key order:

```json
{
  "title": "Example Garden",
  "canonicalHostname": "garden.example.com",
  "navigation": [
    { "path": "about.md", "kind": "markdown" },
    { "path": "notes", "kind": "directory" },
    { "path": "trip-log", "kind": "directory" }
  ]
}
```

Rules:

- Key order is always `title`, `canonicalHostname`, `navigation`.
- `navigation` preserves manifest order, or derived `select` order when the
  manifest has no `navigation` list.
- Default derivation filters out selections with no Markdown pages, so an
  asset-only selection never appears in generated `navigation`.
- Each entry records a normalized relative public path plus its `kind`
  (`directory` or `markdown`).
- Staging validates `navigation` against the staged tree before the atomic
  swap, so generated `navigation` only names staged Markdown content.
- The file never carries a Knowledge Base root, an absolute path, a
  manifest path, or an unselected path.

The reader build consumes staged content plus this identity file. Staging
never modifies a tracked configuration file.
