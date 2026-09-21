# Publication Manifest contract

A Publication Manifest is a small YAML file that opts a Knowledge Base into
web publication. It is the single interface between a content repository and
the Knowledge Web Publisher.

## Location

`publication.manifest.yaml` in the Knowledge Base root. The Publisher looks
here by default; a custom path can be passed with `--manifest`.

## Fields

| Field               | Required | Meaning                                                                                      |
| ------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `title`             | yes      | Human-readable site title, shown in the browser and generated pages.                         |
| `canonicalHostname` | yes      | Canonical DNS hostname of the Web Projection (no scheme, port, or path).                     |
| `select`            | yes      | Explicit allowlist: one or more content roots or files, relative to the Knowledge Base root. |

### Example

```yaml
title: Example Garden
canonicalHostname: garden.example.com
select:
  - notes
  - trip-log
  - about.md
```

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
- `title` and `canonicalHostname` are emitted as deterministic generated site
  identity JSON outside the staged content tree (default
  `site-identity.json`), so each Web Projection carries its own identity
  without modifying `quartz.config.yaml` or another tracked configuration
  file. See ADR-0002 for the Quartz replacement.

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
  "canonicalHostname": "garden.example.com"
}
```

The reader build consumes staged content plus this identity file. Staging
never modifies `quartz.config.yaml` or another tracked configuration file.
