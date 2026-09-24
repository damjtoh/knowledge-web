"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const MANIFEST_URL = "/offline.json"
const SW_URL = "/sw.js"
const SEARCH_INDEX_URL = "/search-index.json"
const POLL_MS = 300
const SAVE_TIMEOUT_MS = 60000

type Status = "checking" | "unsupported" | "idle" | "saving" | "ready" | "incomplete"
type Failure = "access" | "storage" | "interrupted" | "cleared" | null

interface OfflineManifest {
  version: string
  totalBytes: number
  urls: string[]
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "About 0 KB"
  if (value < 1024) return `About ${value} B`
  if (value < 1024 * 1024) return `About ${Math.max(1, Math.round(value / 1024))} KB`
  const mb = value / (1024 * 1024)
  return `About ${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
}

async function readManifest(): Promise<OfflineManifest | null> {
  try {
    const res = await fetch(MANIFEST_URL, { credentials: "same-origin" })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<OfflineManifest>
    if (
      typeof data !== "object" ||
      data === null ||
      typeof data.version !== "string" ||
      typeof data.totalBytes !== "number" ||
      !Array.isArray(data.urls)
    ) {
      return null
    }
    const urls = data.urls.filter((url): url is string => typeof url === "string")
    return { version: data.version, totalBytes: data.totalBytes, urls }
  } catch {
    return null
  }
}

async function countCached(urls: string[]): Promise<number> {
  let done = 0
  for (const url of urls) {
    try {
      // Workbox stores revisioned entries under a versioned cache key; match
      // ignoring the query so the count reflects real precache entries.
      const hit = await caches.match(url, { ignoreSearch: true })
      if (hit && hit.ok) done += 1
    } catch {
      // A single lookup failure leaves the entry uncounted; the save
      // stays incomplete rather than claiming readiness.
    }
  }
  return done
}

/**
 * Save for offline use: one explicit action per Web Projection.
 *
 * The control fetches only the small generated manifest before the reader
 * chooses Save, so visiting or installing never starts a whole-site
 * download. Saving works on any connection. Progress counts real cache
 * entries; Ready offline appears only after every listed export file is
 * cached. On later visits readiness is rechecked against the actual cache,
 * so a browser-cleared copy never keeps a stale Ready label. Failures
 * stay incomplete with a retry; a denied online check never registers a
 * worker, so no sign-in page is cached as publication.
 */
export default function OfflineSave() {
  const [status, setStatus] = useState<Status>("checking")
  const [manifest, setManifest] = useState<OfflineManifest | null>(null)
  const [done, setDone] = useState(0)
  const [failure, setFailure] = useState<Failure>(null)
  const savingRef = useRef(false)

  const checkStored = useCallback(async (listed: OfflineManifest) => {
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) {
        setStatus("idle")
        return
      }
      const cached = await countCached(listed.urls)
      if (cached === listed.urls.length && listed.urls.length > 0) {
        setStatus("ready")
      } else if (cached > 0) {
        setFailure("cleared")
        setStatus("incomplete")
      } else {
        setStatus("idle")
      }
    } catch {
      setStatus("idle")
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function init() {
      if (!("serviceWorker" in navigator) || typeof window.caches === "undefined") {
        if (!cancelled) setStatus("unsupported")
        return
      }
      const listed = await readManifest()
      if (cancelled) return
      if (!listed || listed.urls.length === 0) {
        setStatus("unsupported")
        return
      }
      setManifest(listed)
      setDone(0)
      await checkStored(listed)
    }
    init()
    return () => {
      cancelled = true
    }
  }, [checkStored])

  const save = useCallback(async () => {
    if (savingRef.current) return
    const listed = manifest
    if (!listed) return
    savingRef.current = true
    setFailure(null)
    setDone(0)
    setStatus("saving")
    try {
      // Online-access gate before any whole-site fetch: a denied session
      // (Cloudflare Access redirect or sign-in page) fails here, so the
      // worker is never registered and nothing is cached as publication.
      try {
        const probe = await fetch(SEARCH_INDEX_URL, {
          credentials: "same-origin",
          cache: "no-store",
        })
        if (!probe.ok) throw new Error(`search index ${probe.status}`)
        await probe.json()
      } catch {
        setFailure("access")
        setStatus("incomplete")
        return
      }

      let registration: ServiceWorkerRegistration
      try {
        registration = await navigator.serviceWorker.register(SW_URL)
      } catch (error) {
        setFailure(
          error instanceof DOMException && error.name === "QuotaExceededError"
            ? "storage"
            : "interrupted",
        )
        setStatus("incomplete")
        return
      }

      const started = Date.now()
      for (;;) {
        const cached = await countCached(listed.urls)
        setDone(cached)
        if (cached === listed.urls.length) {
          // Let the activated worker take control so a restart serves offline.
          try {
            await navigator.serviceWorker.ready
          } catch {
            // Readiness already reflects the persisted cache above.
          }
          setStatus("ready")
          return
        }
        if (registration.installing?.state === "redundant") break
        if (Date.now() - started > SAVE_TIMEOUT_MS) break
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }

      let failureKind: Failure = "interrupted"
      try {
        const estimate = await navigator.storage?.estimate()
        if (
          estimate &&
          typeof estimate.quota === "number" &&
          estimate.quota < listed.totalBytes * 2
        ) {
          failureKind = "storage"
        }
      } catch {
        // Storage details are a hint only; the incomplete state stands.
      }
      setFailure(failureKind)
      setStatus("incomplete")
    } finally {
      savingRef.current = false
    }
  }, [manifest])

  if (status === "checking") {
    return (
      <section aria-label="Offline" className="reader-offline">
        <p className="reader-offline-status" role="status" aria-live="polite">
          Checking offline status…
        </p>
      </section>
    )
  }
  if (status === "unsupported" || !manifest) return null

  const total = manifest.urls.length

  if (status === "ready") {
    return (
      <section aria-label="Offline" className="reader-offline">
        <p className="reader-offline-ready" role="status" aria-live="polite">
          Ready offline ({formatBytes(manifest.totalBytes).toLowerCase()} saved on this device).
        </p>
      </section>
    )
  }

  if (status === "saving") {
    return (
      <section aria-label="Offline" className="reader-offline">
        <p className="reader-offline-status" role="status" aria-live="polite">
          Saving… {done} of {total}. Keep this page open.
        </p>
        <progress
          className="reader-offline-progress"
          value={done}
          max={Math.max(1, total)}
          aria-label="Offline save progress"
        />
      </section>
    )
  }

  if (status === "incomplete") {
    return (
      <section aria-label="Offline" className="reader-offline">
        <p className="reader-offline-status" role="alert">
          {failure === "access"
            ? "Save incomplete. Couldn’t reach the publication — check your connection or sign-in, then retry."
            : failure === "storage"
              ? "Save incomplete. Not enough storage — free space, then retry."
              : failure === "cleared"
                ? "Saved data was cleared on this device. Save again for offline reading."
                : "Save incomplete. Some pages didn’t save."}
        </p>
        <button type="button" className="reader-offline-retry" onClick={save}>
          Retry save
        </button>
      </section>
    )
  }

  return (
    <section aria-label="Offline" className="reader-offline">
      <button type="button" className="reader-offline-save" onClick={save}>
        Save for offline use
      </button>
      <p className="reader-offline-size">{formatBytes(manifest.totalBytes)} to download.</p>
      <p className="reader-offline-trust">
        Saved pages stay on this device. Only save on a device you trust.
      </p>
    </section>
  )
}
