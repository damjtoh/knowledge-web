/**
 * Offline generation for the generic static reader.
 *
 * Runs AFTER the Next.js static export and the search-index build. Its ONLY
 * input is the finished export directory (`reader/out`): staged Markdown,
 * the generated site identity, and the built search index have already
 * become static files there. It never reads a Knowledge Base, staging
 * tree, Publication Manifest, or vault path, and it never calls a content
 * API.
 *
 * It writes two same-origin files into the export:
 * - `offline.json`: the reader-facing manifest (version, estimated bytes,
 *   and the exact site-absolute URLs the Save control verifies). Small,
 *   fetched once to show the estimated size; never a whole-site fetch.
 * - `sw.js`: a self-contained Workbox service worker with a revisioned
 *   precache of the export. File revisions are content hashes (Workbox
 *   `workbox-build` behavior); already-hashed `_next/static` URLs reuse
 *   their URL as the version. Every entry also carries a subresource
 *   integrity hash, so each precache fetch enforces exact bytes: a
 *   redirected Cloudflare Access sign-in page (HTTP 200 with wrong bytes)
 *   fails the fetch instead of being cached as publication. Precache
 *   install fetches same-origin with credentials and fails bad responses,
 *   so an interrupted fetch fails the install instead of caching a
 *   partial copy.
 *
 * nginx stays unchanged: the worker mirrors its `try_files $uri $uri.html`
 * mapping for offline navigation by READING the Workbox precache. It never
 * writes custom cache entries and never fetches cross-origin, so no login
 * or redirect response can become publication and one projection cannot
 * mix with another. No `route.ts` content API is involved.
 *
 * Usage:
 *   node ./scripts/build-offline.mjs [--dir <export-dir>]
 */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

const READER_ROOT = path.resolve(scriptDir, "..")

const MAX_PRECACHE_FILE_BYTES = 5 * 1024 * 1024

function argDir() {
  const flag = process.argv.indexOf("--dir")

  if (flag !== -1 && process.argv[flag + 1]) return path.resolve(process.argv[flag + 1])

  if (process.env.OFFLINE_EXPORT_DIR) return path.resolve(process.env.OFFLINE_EXPORT_DIR)

  return path.join(READER_ROOT, "out")
}

function listFilesRecursive(dir, relative = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name

    if (entry.isDirectory()) files.push(...listFilesRecursive(path.join(dir, entry.name), rel))
    else if (entry.isFile()) files.push(rel)
  }

  return files.sort()
}

function hashFile(abs) {
  const digest = crypto.createHash("sha256")
  digest.update(fs.readFileSync(abs))

  return digest.digest("hex").slice(0, 16)
}

/**
 * Subresource integrity value for one export file. Workbox sends it on the
 * precache fetch, so the browser rejects any bytes that are not the exact
 * published file — including a sign-in or redirect page returned with
 * HTTP 200 after an online session expires mid-save.
 */
function integrityOf(abs) {
  const digest = crypto.createHash("sha384")
  digest.update(fs.readFileSync(abs))

  return `sha384-${digest.digest("base64")}`
}

function credentialManifestLinks(outDir) {
  if (!fs.existsSync(path.join(outDir, "manifest.webmanifest"))) return

  // Next.js generates the manifest route and its head link, but does not
  // expose crossorigin for that link. Protected Web Projections need the
  // Access cookie even when the manifest is on the same origin. Change the
  // final HTML before Workbox computes revisions and integrity hashes.
  for (const rel of listFilesRecursive(outDir).filter((name) => name.endsWith(".html"))) {
    const abs = path.join(outDir, rel)
    const html = fs.readFileSync(abs, "utf8")
    const links = html.match(/<link\b[^>]*\brel="manifest"[^>]*>/g) ?? []

    if (links.length !== 1 || !links[0].includes('href="/manifest.webmanifest"')) {
      throw new Error(`expected one generated manifest link in ${rel}`)
    }

    const link = links[0]

    if (link.includes('crossorigin="use-credentials"')) continue

    if (/\bcrossorigin=/.test(link)) throw new Error(`unexpected manifest credentials in ${rel}`)
    fs.writeFileSync(
      abs,
      html.replace(link, link.replace(/\/?>(?=$)/, ' crossorigin="use-credentials"/>')),
    )
  }
}

/**
 * nginx-consistent extensionless mapping appended to the generated worker.
 * Reads the Workbox precache only; never writes entries, never goes
 * cross-origin, never caches a network response here.
 */
const EXTENSIONLESS_HANDLER = `
// Knowledge reader offline route mapping (nginx-consistent, not a cache engine).
// Workbox precache above holds revisioned same-origin entries for exact URLs
// (for example \`/notes/plain.html\`). nginx serves extensionless published
// routes (\`/notes/plain\`) from those files via \`try_files $uri $uri.html\`.
// This listener mirrors that mapping for offline navigation by reading the
// precache. It writes no cache entries and fetches no cross-origin URL, so a
// sign-in or redirect response cannot become publication.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  const isNavigation = request.mode === "navigate" || request.destination === "document";
  if (!isNavigation) return;
  if (url.pathname.includes(".")) return;
  event.respondWith(
    (async () => {
      // Revisioned precache keys carry a version query; match ignoring it.
      const exact = await caches.match(request, { ignoreSearch: true }).catch(() => undefined);
      if (exact && exact.ok) return exact;
      const htmlPath = url.pathname.endsWith("/")
        ? url.pathname + "index.html"
        : url.pathname + ".html";
      const html = await caches.match(htmlPath, { ignoreSearch: true }).catch(() => undefined);
      if (html && html.ok) return html;
      return fetch(request);
    })(),
  );
});
`

async function main() {
  const outDir = argDir()

  if (!fs.existsSync(outDir) || !fs.statSync(outDir).isDirectory()) {
    throw new Error(`export directory not found: ${outDir}`)
  }

  // A rerun must not precache its own previous output.
  for (const generated of ["sw.js", "sw.js.map", "offline.json"]) {
    fs.rmSync(path.join(outDir, generated), { force: true })
  }

  for (const rel of listFilesRecursive(outDir)) {
    if (/^workbox-[\w-]+\.js(\.map)?$/.test(rel)) fs.rmSync(path.join(outDir, rel), { force: true })
  }

  credentialManifestLinks(outDir)

  // Publication files only: everything the static export emitted, minus
  // source maps (never needed to read or navigate offline).
  const all = listFilesRecursive(outDir).filter((rel) => !rel.endsWith(".map"))

  if (!all.includes("search-index.json")) {
    throw new Error("export has no search-index.json; run the search-index build first")
  }

  const urls = all.map((rel) => `/${rel.split(path.sep).join("/")}`)
  let totalBytes = 0
  const fingerprints = []
  const integrityByUrl = new Map()

  for (const rel of all) {
    const abs = path.join(outDir, rel)
    const size = fs.statSync(abs).size

    if (size > MAX_PRECACHE_FILE_BYTES) {
      throw new Error(
        `offline export file exceeds the Workbox precache limit: ${rel} (${size} bytes)`,
      )
    }

    totalBytes += size
    fingerprints.push(`${rel}:${hashFile(abs)}`)
    integrityByUrl.set(rel.split(path.sep).join("/"), integrityOf(abs))
  }

  const version = crypto
    .createHash("sha256")
    .update(fingerprints.join("\n"))
    .digest("hex")
    .slice(0, 16)

  const manifest = { version, totalBytes, urls }
  fs.writeFileSync(path.join(outDir, "offline.json"), JSON.stringify(manifest))
  // The reader-facing manifest joins the precache with the same guard.
  integrityByUrl.set("offline.json", integrityOf(path.join(outDir, "offline.json")))

  const { generateSW } = await import("workbox-build").catch((error) => {
    throw new Error(
      `workbox-build is required for offline generation (run npm install in reader/): ${error.message}`,
    )
  })

  const result = await generateSW({
    globDirectory: outDir,
    globPatterns: ["**/*"],
    globIgnores: ["sw.js", "sw.js.map", "workbox-*.js", "**/*.map"],
    swDest: path.join(outDir, "sw.js"),
    // Update lifecycle: a new publication installs to waiting and never
    // claims clients. The current reading session stays on the previous
    // complete precache until the reader chooses Reload; a failed install
    // (interrupted fetch, wrong bytes) never activates, so the old copy
    // stays usable. Activation cleans outdated caches, so removed pages
    // stop being served offline after the reload.
    clientsClaim: false,
    skipWaiting: false,
    cleanupOutdatedCaches: true,
    // Self-contained worker: no separate runtime file to fetch on a later
    // offline restart, and no source maps in the published export.
    inlineWorkboxRuntime: true,
    sourcemap: false,
    // Fetch-time publication guard: every precache entry enforces its exact
    // export bytes. A redirect or sign-in response (wrong bytes) fails that
    // entry's fetch, which fails the install, so the save stays incomplete
    // instead of caching login output as a published page. Unknown fields
    // pass through Workbox's own revision pipeline untouched.
    manifestTransforms: [
      (entries) => ({
        manifest: entries.map((entry) => ({
          ...entry,
          integrity: integrityByUrl.get(entry.url) ?? entry.integrity,
        })),
        warnings: [],
      }),
    ],
    // Next.js hashed assets already carry versioning in the URL; Workbox
    // reuses the URL instead of adding a revision query.
    dontCacheBustURLsMatching: /_next\/static\//,
    maximumFileSizeToCacheInBytes: MAX_PRECACHE_FILE_BYTES,
    mode: "production",
  })

  // Workbox can skip a file with a warning rather than fail the build.
  // The reader promises every listed file, so never publish a partial worker.
  if (result.warnings.length || result.count !== urls.length + 1) {
    fs.rmSync(path.join(outDir, "sw.js"), { force: true })
    fs.rmSync(path.join(outDir, "offline.json"), { force: true })
    throw new Error(
      `offline precache is incomplete: ${result.warnings.join("; ") || "file count mismatch"}`,
    )
  }

  fs.appendFileSync(path.join(outDir, "sw.js"), EXTENSIONLESS_HANDLER)
  console.log(
    `[offline] precached ${urls.length} export files (${totalBytes} bytes, version ${version}) -> ${path.relative(READER_ROOT, path.join(outDir, "sw.js"))}`,
  )
}

await main()
