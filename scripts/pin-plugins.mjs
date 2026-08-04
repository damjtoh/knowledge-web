#!/usr/bin/env node
/**
 * Pin community plugins to the exact commits recorded in quartz.lock.json.
 *
 * Quartz's own `plugin install` clones plugins in parallel; on a fresh tree
 * that can fail transiently, and its retry path ("update") fetches only the
 * default branch, which cannot satisfy a pinned commit. This script clones
 * every plugin serially with retries at the pinned commit. The subsequent
 * `plugin install` then finds every plugin already at its pinned commit and
 * only builds/links it.
 *
 * Run before `npm run install-plugins` (the npm script already does both).
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..")
const LOCKFILE_PATH = path.join(PUBLISHER_ROOT, "quartz.lock.json")
const PLUGINS_DIR = path.join(PUBLISHER_ROOT, ".quartz", "plugins")

function run(args, cwd = process.cwd()) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim()
}

function clonePinned(name, entry) {
  const dir = path.join(PLUGINS_DIR, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  run(["clone", "--quiet", "--depth", "1", entry.resolved, dir])
  // GitHub serves reachable SHAs: fetch the pinned commit into the shallow
  // clone and check it out detached.
  run(["fetch", "--quiet", "--depth", "1", "origin", entry.commit], dir)
  run(["checkout", "--quiet", entry.commit], dir)
  const head = run(["rev-parse", "HEAD"], dir)
  if (head !== entry.commit) {
    throw new Error(`${name}: HEAD ${head} does not match pinned commit ${entry.commit}`)
  }
  console.log(`  ✓ ${name}@${entry.commit.slice(0, 7)}`)
}

function main() {
  if (!fs.existsSync(LOCKFILE_PATH)) {
    console.error(`✗ ${LOCKFILE_PATH} not found; nothing to pin`)
    process.exit(1)
  }
  const lockfile = JSON.parse(fs.readFileSync(LOCKFILE_PATH, "utf8"))
  const entries = Object.entries(lockfile.plugins ?? {})

  let failed = 0
  for (const [name, entry] of entries) {
    if (entry.commit === "local") {
      console.log(`  - ${name}: local plugin, skipping`)
      continue
    }
    if (entry.subdir) {
      console.error(`✗ ${name}: subdir plugins are not supported by the pin script`)
      failed++
      continue
    }
    const dir = path.join(PLUGINS_DIR, name)
    let head = null
    try {
      head = run(["rev-parse", "HEAD"], dir)
    } catch {
      // missing or not a git repository: clone below
    }
    if (head === entry.commit) {
      console.log(`  ✓ ${name} already at pinned commit`)
      continue
    }

    let ok = false
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        clonePinned(name, entry)
        ok = true
      } catch (error) {
        console.error(`  ✗ ${name}: ${error.message} (attempt ${attempt}/3)`)
      }
    }
    if (!ok) failed++
  }

  if (failed > 0) {
    console.error(`✗ failed to pin ${failed} plugin(s); refusing to continue`)
    process.exit(1)
  }
  console.log(`✓ ${entries.length} plugin(s) pinned to quartz.lock.json commits`)
}

main()
