# Adopting the Publisher in a Knowledge Base

Adoption is deliberately thin: a Knowledge Base adds a Publication Manifest
and a small multi-stage container build. It does **not** copy Quartz or the
Publisher into its own repository.

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

## 2. Add a thin multi-stage Docker build

The build fetches the public Publisher at an **immutable commit SHA** (never
a branch or a mutable tag), installs its locked dependencies, validates the
manifest, stages the allowlisted content, builds the static site, and copies
only the generated output into a minimal nginx runtime.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS publisher

# git is required by Quartz to install its community plugins
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

# Locked npm dependencies, then community plugins at their pinned commits
RUN npm ci && npm run install-plugins

# Stage the Knowledge Base: manifest validation, allowlisted content copy,
# landing page generation, site identity injection.
WORKDIR /kb
COPY . .
RUN node /publisher/scripts/stage-content.mjs \
    --kb-root /kb \
    --content-dir /publisher/content \
    --config-file /publisher/quartz.config.yaml

WORKDIR /publisher
RUN npm run build

# ---- Runtime: minimal nginx, stateless ----
FROM nginx:alpine
COPY --from=publisher /publisher/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=publisher /publisher/public /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

Notes:

- The Docker build context is the private Knowledge Base repository, but only
  allowlisted content enters the image. Unselected repository files exist in
  the build context and nowhere else.
- The runtime image contains static files only: no database, no writable
  volume, no Git, no sync worker, no API.
- Keep `ARG PUBLISHER_REV` explicit so a rebuild cannot change behavior
  because a remote branch or tag moved.

## 3. Runtime contract

The image serves the generated `public/` directory through the Publisher's
`nginx.conf` (`index index.html;` plus `try_files $uri $uri.html $uri/ =404;`
and long-lived immutable caching under `/static/`). It listens on port 80,
requires no environment variables, and holds no state.

## 4. Upgrading the Publisher

Upgrading is an explicit repository change: bump `PUBLISHER_REV` to a new
immutable commit SHA and rebuild. Each Web Projection is then reviewed and
rolled back independently.

## 5. Deployment

Deploy the image through your established Service Slot (e.g. Dokploy) with
automatic rebuilds from the Knowledge Base's canonical `main` branch. Protect
the hostname with an identity-aware reverse proxy (e.g. Cloudflare Access) at
the application boundary; the manifest controls what the application
contains, the proxy controls who may reach it. Both boundaries are required.

## 6. Local development

```bash
git clone <publisher repo> /tmp/publisher && cd /tmp/publisher
npm ci && npm run install-plugins
node scripts/stage-content.mjs --kb-root /path/to/knowledge-base
npm run build
npm run serve   # local preview at http://localhost:8080
```

The staged build tree lives in the Publisher checkout (`content/`, `public/`,
`.quartz/`), never in the Knowledge Base.
