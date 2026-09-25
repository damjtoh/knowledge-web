# Adopting the Publisher in a Knowledge Base

Adoption is deliberately thin: a Knowledge Base adds a Publication Manifest
and a small multi-stage container build. It does **not** copy the Publisher
into its own repository.

## 1. Declare what to publish

Add `publication.manifest.yaml` to the Knowledge Base root. See the
[manifest contract](manifest.md). Start with only what you intend to publish:

```yaml
title: Example Garden
canonicalHostname: garden.example.com
select:
  - notes
  - about.md
```

The allowlist is the authority: adding new repository files never publishes
them silently. Publishing more content is an explicit manifest change.

### Optional ordered navigation

Add `navigation` only when the visible reader order differs from `select`
order, or when an allowlisted selection should stay staged but hidden.
`navigation` is presentation metadata only: it cannot broaden `select`,
publish an unselected path, or admit a non-Markdown page. When `navigation`
is absent, staging derives visible roots from `select` in manifest order,
keeping Markdown files and directories with Markdown pages and ignoring
asset-only selections. Existing manifests without `navigation` stay valid.

A selected directory does not need an authored `index.md`. The Knowledge
reader serves a virtual static folder page with a humanized title and child
navigation; an authored `index.md` owns its folder route and introduction.
Binary attachment delivery is deferred: allowlisted non-Markdown files are
staged byte-for-byte but never become pages or navigation entries.

Synthetic examples only. No private content or routes.

Shared-like: directories plus one standalone file, with an explicit visible
order:

```yaml
title: Example Garden
canonicalHostname: garden.example.com
select:
  - garden
  - orchard
  - cellar
  - inbox.md
navigation:
  - inbox.md
  - garden
  - orchard
```

Damian-like: several directories, some without an authored `index.md`.
Index-less directories get virtual folder pages:

```yaml
title: Example Plots
canonicalHostname: plots.example.com
select:
  - workout
  - notes
  - personal
  - work
  - health
navigation:
  - workout
  - notes
  - personal
  - work
  - health
```

Mica-like: directories plus an asset-heavy selection. The asset pack stays
staged but has no navigation root:

```yaml
title: Example Studio
canonicalHostname: studio.example.com
select:
  - work
  - workout
  - attachments/handouts
navigation:
  - work
  - workout
```

## 2. Build the static Knowledge reader

Stage the allowlist, then build the reader from staged content plus
generated metadata only. The reader never reads the Knowledge Base or the
manifest. Its only inputs are the neutral variables `READER_CONTENT_DIR`
and `READER_SITE_METADATA_FILE`.

```bash
node scripts/stage-content.mjs --kb-root /path/to/knowledge-base
cd reader && pnpm install --frozen-lockfile && pnpm run build   # emits the static reader into reader/out/
```

Preview the export with an nginx-style static server (`pnpm dlx serve out`).
`reader/.source/`, `reader/.next/`, and `reader/out/` are disposable build
artifacts and stay untracked. See the [Knowledge reader](../reader/README.md)
and [the manifest contract](manifest.md).

## 3. Container build

The build fetches the public Publisher at an **immutable commit SHA** (never
a branch or a mutable tag), installs its locked dependencies, validates the
manifest, stages the allowlisted content, builds the static reader, and
copies only the generated output into a minimal nginx runtime.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:26-alpine AS publisher

# git is required to fetch the Publisher at an immutable revision
RUN apk add --no-cache git

# Immutable Publisher revision: the full commit SHA of the public
# Knowledge Web Publisher repository. Example SHA shown for illustration;
# real integrations must pin the actual full commit SHA.
ARG PUBLISHER_REPO=https://github.com/damjtoh/knowledge-web.git
ARG PUBLISHER_REV=0123456789abcdef0123456789abcdef01234567

WORKDIR /publisher
RUN git init -q \
    && git remote add origin ${PUBLISHER_REPO} \
    && git fetch -q --depth 1 origin ${PUBLISHER_REV} \
    && git checkout -q FETCH_HEAD

# pnpm installs the locked dependencies
RUN npm install -g pnpm@12 && pnpm install --frozen-lockfile

# Stage the Knowledge Base: manifest validation, allowlisted content copy,
# landing page generation, generated site identity emission. Staging never
# mutates a tracked configuration file.
WORKDIR /kb
COPY . .
RUN node /publisher/scripts/stage-content.mjs \
    --kb-root /kb \
    --content-dir /publisher/content \
    --identity-file /publisher/site-identity.json

WORKDIR /publisher/reader
RUN pnpm install --frozen-lockfile && pnpm run build

# ---- Runtime: minimal nginx, stateless ----
FROM nginx:alpine
COPY --from=publisher /publisher/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=publisher /publisher/reader/out /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Notes:

- The Docker build context is the private Knowledge Base repository, but only
  allowlisted content plus generated `site-identity.json` enter the build.
  Unselected repository files exist in the build context and nowhere else.
- The runtime image contains static files only: no database, no writable
  volume, no Git, no sync worker, no API.
- Keep `ARG PUBLISHER_REV` explicit so a rebuild cannot change behavior
  because a remote branch or tag moved.
- The publisher allowlist, staging, canonical Markdown/Git, and stateless
  runtime boundaries are retained (see ADR-0002, ADR-0003, ADR-0004).

## 4. Runtime contract

The image serves the generated `reader/out/` directory through the
Publisher's `nginx.conf` (`index index.html;` plus
`try_files $uri $uri.html $uri/ =404;` and long-lived immutable caching
under `/_next/static/`). It listens on port 80, requires no environment
variables, and holds no state.

## 5. Upgrading the Publisher

Upgrading is an explicit repository change: bump `PUBLISHER_REV` to a new
immutable commit SHA and rebuild. Each Web Projection is then reviewed and
rolled back independently.

## 6. Deployment

Deploy the image through your established Service Slot (e.g. Dokploy) with
automatic rebuilds from the Knowledge Base's canonical `main` branch. Protect
the hostname with an identity-aware reverse proxy (e.g. Cloudflare Access) at
the application boundary; the manifest controls what the application
contains, the proxy controls who may reach it. Both boundaries are required.

## 7. Local development

```bash
git clone <publisher repo> /tmp/publisher && cd /tmp/publisher
pnpm install --frozen-lockfile
node scripts/stage-content.mjs --kb-root /path/to/knowledge-base
cd reader && pnpm install --frozen-lockfile && pnpm run build
pnpm dlx serve out   # local preview of the static reader export
```

Run the synthetic suites through the `tsx` runner (never the plain Node
runner for suites that import TypeScript reader modules):

```bash
pnpm test tests/stage-content.test.mjs tests/knowledge-reader-contract.test.mjs tests/navigation.test.mjs tests/wiki-aliases.test.mjs
pnpm run test:reader
pnpm run test:reader:browser
KNOWLEDGE_BASE_ROOT=/path/to/vault pnpm test tests/knowledge-reader-static.test.mjs tests/knowledge-reader-journey-browser.test.mjs tests/knowledge-reader-phone-browser.test.mjs
```

The staged build tree plus generated site metadata live in the Publisher
checkout (`content/`, `site-identity.json`, `reader/out/`), never in
the Knowledge Base.
