"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import {
  Check,
  Database,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react"
import { Button } from "./ui/button"

const MANIFEST_URL = "/offline.json"

const SW_URL = "/sw.js"

const SEARCH_INDEX_URL = "/search-index.json"

const POLL_MS = 300

const SAVE_TIMEOUT_MS = 60000

const UPDATE_CHECK_MS = 60_000

type Status =
  "checking" | "unsupported" | "idle" | "saving" | "ready" | "incomplete" | "remove-failed"

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

function isManifestString(value: unknown): value is string {
  return String(value) === value
}

function isManifestNumber(value: unknown): value is number {
  return Object.prototype.toString.call(value) === "[object Number]"
}

function isManifestRecord(
  value: Partial<OfflineManifest> | null,
): value is Partial<OfflineManifest> {
  return value !== null && Object(value) === value && !(value instanceof Function)
}

async function readManifest(): Promise<OfflineManifest | null> {
  try {
    // No-store so an update check never reads a cached manifest version;
    // the deployed worker also serves this file with no-cache headers.
    const res = await fetch(MANIFEST_URL, { credentials: "same-origin", cache: "no-store" })

    if (!res.ok) return null
    // SAFETY: res.json() yields unknown JSON; record plus field checks below validate the manifest shape before use.
    const data = (await res.json()) as Partial<OfflineManifest>

    if (
      !isManifestRecord(data) ||
      !isManifestString(data.version) ||
      !isManifestNumber(data.totalBytes) ||
      !Array.isArray(data.urls)
    ) {
      return null
    }

    const urls = data.urls.filter(isManifestString)

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

interface OfflineValue {
  status: Status
  manifest: OfflineManifest | null
  done: number
  failure: Failure
  updateAvailable: boolean
  reloading: boolean
  removing: boolean
  save: () => Promise<void>
  reloadUpdate: () => Promise<void>
  removeCopy: () => Promise<void>
}

const OfflineContext = createContext<OfflineValue | null>(null)

/**
 * Single mounted offline state for the reader shell.
 *
 * One provider lives at the shell root so the desktop SidebarFooter,
 * the phone drawer footer, and the closed-phone header cue all read the
 * same status. The detailed footer actions and the compact cue share this
 * value; the cue never initiates a save.
 */
export function useOffline(): OfflineValue {
  const value = useContext(OfflineContext)

  if (!value) throw new Error("useOffline must be used within OfflineProvider.")

  return value
}

/**
 * Device status chip for the phone header.
 *
 * Display only: shares the provider state with the detailed footer
 * actions and never starts a save. Every status renders a pill with a
 * 12px icon plus an 11px label; unsupported renders the "Not saved"
 * variant instead of hiding, so the cue never disappears.
 */
export function OfflineCue() {
  const { status, manifest, done, updateAvailable } = useOffline()
  const [online, setOnline] = useState(true)

  useEffect(() => {
    setOnline(navigator.onLine)

    const markOnline = () => setOnline(true)
    const markOffline = () => setOnline(false)

    window.addEventListener("online", markOnline)
    window.addEventListener("offline", markOffline)

    return () => {
      window.removeEventListener("online", markOnline)
      window.removeEventListener("offline", markOffline)
    }
  }, [])

  // Saved page count shares the footer source (the manifest URL list),
  // so the chip and the footer never disagree.
  const total = manifest?.urls.length ?? 0

  let text = ""
  let Icon: typeof Wifi | null = null
  let muted = false
  let role: "status" | "alert" = "status"

  if (status === "checking") {
    text = "Checking…"
    muted = true
  } else if (status === "saving") {
    text = total > 0 ? `Saving… ${done} of ${total}` : "Saving…"
  } else if (status === "ready" && updateAvailable) {
    Icon = Wifi
    text = "Update ready"
  } else if (status === "ready") {
    Icon = online ? Wifi : WifiOff
    text = online ? `${total} saved` : `Offline · ${total} saved`
  } else if (status === "incomplete") {
    text = "Save incomplete"
    role = "alert"
  } else if (status === "remove-failed") {
    text = "Couldn't remove offline copy"
    role = "alert"
  } else {
    Icon = Database
    text = "Not saved"
    muted = true
  }

  return (
    <p
      className={
        muted
          ? "reader-offline-cue hidden h-7 max-w-40 items-center gap-1.5 rounded-full bg-muted px-3 text-2xs text-muted-foreground max-md:inline-flex"
          : "reader-offline-cue hidden h-7 max-w-40 items-center gap-1.5 rounded-full bg-muted px-3 text-2xs text-primary max-md:inline-flex"
      }
      data-offline-state={status}
      data-update={updateAvailable ? "true" : undefined}
      data-online={online ? undefined : "false"}
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0" /> : null}
      <span className="truncate">{text}</span>
    </p>
  )
}

/**
 * Shell offline state: one explicit action per Web Projection.
 *
 * The provider fetches only the small generated manifest before the reader
 * chooses Save, so visiting or installing never starts a whole-site
 * download. Saving works on any connection. Progress counts real cache
 * entries; Ready offline appears only after every listed export file is
 * cached. On later visits readiness is rechecked against the actual cache,
 * so a browser-cleared copy never keeps a stale Ready label. Failures
 * stay incomplete with a retry; a denied online check never registers a
 * worker, so no sign-in page is cached as publication.
 *
 * Updates replace the saved publication completely: the new worker
 * installs to waiting (never claims clients), so the current reading
 * session keeps the previous complete copy until the reader chooses
 * Reload. Update ready — Reload appears only when the waiting worker is
 * installed, which means the whole new precache downloaded. A failed or
 * interrupted update never activates, so the previous pages and search
 * index stay usable and no login response is cached (precache integrity
 * rejects wrong bytes). Reload activates the new worker; outdated caches
 * are then cleaned, so removed pages stop serving offline and pages plus
 * search come from the same new version. Removal clears only this Web
 * Projection: it unregisters this scope's worker and deletes only this
 * scope's Workbox precache caches, so unrelated same-origin caches stay
 * and other origins stay unaffected. After removal the control returns
 * to the explicit Save action; later visits never re-register on their own.
 */
export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking")
  const [manifest, setManifest] = useState<OfflineManifest | null>(null)
  const [done, setDone] = useState(0)
  const [failure, setFailure] = useState<Failure>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const savingRef = useRef(false)
  const waitingRef = useRef<ServiceWorker | null>(null)
  const watchingRef = useRef(false)
  const removalScopeRef = useRef<string | null>(null)

  const markWaiting = useCallback((worker: ServiceWorker | null) => {
    // Installed with a controller means the complete replacement is
    // downloaded and waiting; the first install has no controller, so it
    // never offers an update. A redundant worker means the update failed
    // and the previous complete copy stays in use.
    if (!worker) return

    if (worker.state === "installed" && navigator.serviceWorker.controller) {
      waitingRef.current = worker
      setUpdateAvailable(true)
    }
  }, [])

  const watchUpdates = useCallback(async () => {
    try {
      if (!("serviceWorker" in navigator)) return
      const registration = await navigator.serviceWorker.getRegistration()

      if (!registration) return

      const track = (worker: ServiceWorker | null) => {
        if (!worker) return
        markWaiting(worker)
        worker.addEventListener("statechange", () => markWaiting(worker))
      }

      if (registration.waiting) {
        waitingRef.current = registration.waiting

        // Waiting at load already means a complete replacement is ready.
        if (navigator.serviceWorker.controller) setUpdateAvailable(true)
      }

      if (registration.installing) track(registration.installing)
      registration.addEventListener("updatefound", () => track(registration.installing))

      // Explicit update check; the deployed worker serves sw.js with
      // no-cache headers so this always sees a new publication.
      try {
        await registration.update()
      } catch {
        // An interrupted check leaves the previous copy usable.
      }

      const fresh = await navigator.serviceWorker.getRegistration()

      if (fresh?.waiting && navigator.serviceWorker.controller) {
        waitingRef.current = fresh.waiting
        setUpdateAvailable(true)
      }

      if (fresh?.installing) track(fresh.installing)
    } catch {
      // Update checks never disturb the current reading session.
    }
  }, [markWaiting])

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

  // Once the saved copy is ready, watch for a complete replacement. The
  // prompt appears only after the new worker finishes installing; the
  // session is never reloaded automatically.
  useEffect(() => {
    if (status !== "ready" || watchingRef.current) return
    watchingRef.current = true
    watchUpdates()
  }, [status, watchUpdates])

  // Keep an open saved reader up to date without forcing a reload or
  // downloading a new publication on a device that was never saved.
  useEffect(() => {
    if (status !== "ready") return

    const check = async () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return

      try {
        const registration = await navigator.serviceWorker.getRegistration()
        await registration?.update()
      } catch {
        // The current complete offline copy stays available.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void check()
    }

    const timer = window.setInterval(() => void check(), UPDATE_CHECK_MS)
    window.addEventListener("online", check)
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener("online", check)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [status])

  const reloadUpdate = useCallback(async () => {
    const waiting = waitingRef.current

    if (!waiting) {
      window.location.reload()

      return
    }

    if (reloading) return
    setReloading(true)

    try {
      await new Promise<void>((resolve) => {
        let settled = false

        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }

        const onControllerChange = () => {
          navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
          finish()
        }

        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)

        try {
          waiting.postMessage({ type: "SKIP_WAITING" })
        } catch {
          finish()

          return
        }

        setTimeout(finish, 3000)
      })
    } catch {
      // Reloading still moves to the new worker when it has activated.
    }

    window.location.reload()
  }, [reloading])

  const removeCopy = useCallback(async () => {
    if (removing) return
    setRemoving(true)

    try {
      // Capture this scope before unregistering, so only this Web
      // Projection's precache goes. Other origins are per-origin and
      // stay unaffected; unrelated same-origin caches never carry
      // the precache marker and are kept.
      const current = await navigator.serviceWorker.getRegistration()
      const scope = current?.scope ?? removalScopeRef.current

      if (!scope) throw new Error("offline worker scope unavailable")
      removalScopeRef.current = scope

      if (current && !(await current.unregister()))
        throw new Error("offline worker still registered")
      const keys = await caches.keys()
      const targets = keys.filter((name) => name === `workbox-precache-v2-${scope}`)
      const deleted = await Promise.all(targets.map((name) => caches.delete(name)))

      if (deleted.some((success) => !success)) throw new Error("offline cache not removed")
      removalScopeRef.current = null
      waitingRef.current = null
      watchingRef.current = false
      setUpdateAvailable(false)
      setFailure(null)
      setDone(0)
      setStatus("idle")
    } catch {
      // Do not claim success or erase other scopes when ownership or
      // deletion cannot be confirmed. Retain the scope for a safe retry.
      setStatus("remove-failed")
    } finally {
      setRemoving(false)
    }
  }, [removing])

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
          isManifestNumber(estimate.quota) &&
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

  return (
    <OfflineContext.Provider
      value={{
        status,
        manifest,
        done,
        failure,
        updateAvailable,
        reloading,
        removing,
        save,
        reloadUpdate,
        removeCopy,
      }}
    >
      {children}
    </OfflineContext.Provider>
  )
}

/**
 * Shared offline section frame and label row.
 *
 * One local seam for the repeated states below: the frame owns the grid
 * container visuals (grid gap-2 with min/max containment) and the label
 * owns the ON DEVICE row. Hooks stay as non-visual DOM/test selectors.
 * Copy, roles, live regions, and actions stay per state.
 */
function OfflineSection({ state, children }: { state: string; children: React.ReactNode }) {
  return (
    <section
      aria-label="Offline"
      className="reader-offline grid min-w-0 max-w-full gap-2"
      data-offline-state={state}
    >
      {children}
    </section>
  )
}

function OfflineLabel({ trailing }: { trailing: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Check aria-hidden="true" className="size-3 text-success" />
      <span className="text-2xs font-semibold tracking-label text-muted-foreground">ON DEVICE</span>
      {trailing}
    </div>
  )
}

/**
 * Detailed offline actions for the sidebar and drawer footers.
 *
 * Reads the single shell provider state; two mounted details (desktop
 * SidebarFooter and phone drawer footer) stay in sync. Presentation
 * follows the design On Device skeleton: a label row (check plus ON
 * DEVICE plus a state icon), a title line, a description line, and an
 * actions row of registry Button pills. Utilities own container, label,
 * text (text-sm muted with text-primary font-semibold on ready,
 * wrap-break-word), Button pills
 * (min-h-11 floors with token hover/dark), and progress (w-full h-3
 * max-w-96); hooks stay as non-visual selectors. Copy reuses the existing real
 * data and formatBytes output with its honest About rounding. Every
 * real status keeps working: checking, idle with explicit Save, saving
 * with progress, ready, update-ready Reload, incomplete with retry,
 * named Remove, and remove-failed retry. The remove action is
 * icon-only with an explicit accessible name.
 */
export default function OfflineSave() {
  const {
    status,
    manifest,
    done,
    failure,
    updateAvailable,
    reloading,
    removing,
    save,
    reloadUpdate,
    removeCopy,
  } = useOffline()

  if (status === "checking") {
    return (
      <OfflineSection state="checking">
        <OfflineLabel
          trailing={
            <Loader2
              aria-hidden="true"
              className="size-3 text-muted-foreground ml-auto animate-spin"
            />
          }
        />
        <p
          className="reader-offline-status m-0 text-sm font-semibold text-muted-foreground wrap-break-word"
          role="status"
          aria-live="polite"
        >
          Checking offline status…
        </p>
        <p className="m-0 text-2xs text-muted-foreground wrap-break-word">
          Looking for a saved copy on this device.
        </p>
      </OfflineSection>
    )
  }

  if (status === "unsupported" || !manifest) {
    return (
      <OfflineSection state="unsupported">
        <OfflineLabel
          trailing={<WifiOff aria-hidden="true" className="size-3 text-muted-foreground ml-auto" />}
        />
        <p className="m-0 text-xs font-semibold text-primary wrap-break-word">
          Not saved on this device
        </p>
        {manifest ? (
          <p className="reader-offline-size m-0 text-sm text-muted-foreground wrap-break-word">
            {formatBytes(manifest.totalBytes)} to download.
          </p>
        ) : null}
        <p className="reader-offline-trust m-0 text-sm text-muted-foreground wrap-break-word">
          Saved pages stay on this device. Only save on a device you trust.
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            className="reader-offline-save flex-1 rounded-full px-2.5 py-1.5 gap-1.5 min-h-11"
            disabled
            title="Saving is not available in this browser"
          >
            <Download aria-hidden="true" className="size-3" />
            <span className="text-2xs font-semibold">Save for offline use</span>
          </Button>
        </div>
      </OfflineSection>
    )
  }

  const total = manifest.urls.length

  if (status === "ready") {
    return (
      <OfflineSection state="ready">
        <OfflineLabel
          trailing={
            updateAvailable ? (
              <RefreshCw aria-hidden="true" className="size-3 text-success ml-auto" />
            ) : (
              <Wifi aria-hidden="true" className="size-3 text-success ml-auto" />
            )
          }
        />
        <p className="m-0 text-xs font-semibold text-primary wrap-break-word">
          {updateAvailable ? "Update ready" : "Saved on this device"}
        </p>
        <p
          className="reader-offline-ready m-0 text-sm font-semibold text-primary wrap-break-word"
          role="status"
          aria-live="polite"
        >
          Ready offline ({formatBytes(manifest.totalBytes).toLowerCase()} saved on this device).
        </p>
        <div className="flex items-center gap-1.5">
          {updateAvailable ? (
            <Button
              type="button"
              variant="outline"
              className="reader-offline-reload flex-1 rounded-full px-2.5 py-1.5 gap-1.5 min-h-11"
              onClick={reloadUpdate}
              disabled={reloading}
            >
              <RefreshCw aria-hidden="true" className="size-3" />
              <span className="text-2xs font-semibold">
                {reloading ? "Reloading…" : "Update ready — Reload"}
              </span>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="reader-offline-remove rounded-full px-2.5 py-1.5 gap-1.5 min-h-11 min-w-11"
            onClick={removeCopy}
            disabled={removing}
            aria-label={removing ? "Removing…" : "Remove offline copy"}
            title={removing ? "Removing…" : "Remove offline copy"}
          >
            {removing ? (
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="size-3" />
            )}
          </Button>
        </div>
      </OfflineSection>
    )
  }

  if (status === "saving") {
    return (
      <OfflineSection state="saving">
        <OfflineLabel
          trailing={
            <Loader2
              aria-hidden="true"
              className="size-3 text-muted-foreground ml-auto animate-spin"
            />
          }
        />
        <p className="m-0 text-xs font-semibold text-primary wrap-break-word">
          Saving… {done} of {total}
        </p>
        <p
          className="reader-offline-status m-0 text-sm text-muted-foreground wrap-break-word"
          role="status"
          aria-live="polite"
        >
          Saving… {done} of {total}. Keep this page open.
        </p>
        <div className="flex items-center gap-1.5">
          <progress
            className="reader-offline-progress h-3 w-full max-w-96"
            value={done}
            max={Math.max(1, total)}
            aria-label="Offline save progress"
          />
        </div>
      </OfflineSection>
    )
  }

  if (status === "remove-failed") {
    return (
      <OfflineSection state="remove-failed">
        <OfflineLabel
          trailing={
            <TriangleAlert aria-hidden="true" className="size-3 text-destructive ml-auto" />
          }
        />
        <p className="m-0 text-xs font-semibold text-primary wrap-break-word">
          Couldn’t remove the offline copy
        </p>
        <p
          className="reader-offline-status reader-offline-remove-error m-0 text-sm text-muted-foreground wrap-break-word"
          role="alert"
        >
          Couldn’t remove the offline copy. Try again before leaving this device.
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            className="reader-offline-remove rounded-full px-2.5 py-1.5 gap-1.5 min-h-11 min-w-11"
            onClick={removeCopy}
            disabled={removing}
            aria-label={removing ? "Removing…" : "Retry removal"}
            title={removing ? "Removing…" : "Retry removal"}
          >
            {removing ? (
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="size-3" />
            )}
          </Button>
        </div>
      </OfflineSection>
    )
  }

  if (status === "incomplete") {
    return (
      <OfflineSection state="incomplete">
        <OfflineLabel
          trailing={<WifiOff aria-hidden="true" className="size-3 text-destructive ml-auto" />}
        />
        <p className="m-0 text-xs font-semibold text-primary wrap-break-word">Save incomplete</p>
        <p
          className="reader-offline-status m-0 text-sm text-muted-foreground wrap-break-word"
          role="alert"
        >
          {failure === "access"
            ? "Save incomplete. Couldn’t reach the publication — check your connection or sign-in, then retry."
            : failure === "storage"
              ? "Save incomplete. Not enough storage — free space, then retry."
              : failure === "cleared"
                ? "Saved data was cleared on this device. Save again for offline reading."
                : "Save incomplete. Some pages didn’t save."}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            className="reader-offline-retry flex-1 rounded-full px-2.5 py-1.5 gap-1.5 min-h-11"
            onClick={save}
          >
            <RefreshCw aria-hidden="true" className="size-3" />
            <span className="text-2xs font-semibold">Retry save</span>
          </Button>
        </div>
      </OfflineSection>
    )
  }

  return (
    <OfflineSection state="idle">
      <OfflineLabel
        trailing={<WifiOff aria-hidden="true" className="size-3 text-muted-foreground ml-auto" />}
      />
      <p className="m-0 text-xs font-semibold text-primary wrap-break-word">
        Not saved on this device
      </p>
      <p className="reader-offline-size m-0 text-sm text-muted-foreground wrap-break-word">
        {formatBytes(manifest.totalBytes)} to download.
      </p>
      <p className="reader-offline-trust m-0 text-sm text-muted-foreground wrap-break-word">
        Saved pages stay on this device. Only save on a device you trust.
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          className="reader-offline-save flex-1 rounded-full px-2.5 py-1.5 gap-1.5 min-h-11"
          onClick={save}
        >
          <Download aria-hidden="true" className="size-3" />
          <span className="text-2xs font-semibold">Save for offline use</span>
        </Button>
      </div>
    </OfflineSection>
  )
}
