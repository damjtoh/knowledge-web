"use client"

import { Archive, Check, XIcon } from "lucide-react"
import type { ProjectionDestination } from "../lib/site"
import { Sheet, SheetClose, SheetContent, SheetTitle } from "./ui/sheet"

/**
 * Hostname shown under each destination name.
 *
 * The design shows a "Work • 123 notes" meta line, but the reader has
 * no cross-origin note-count data, so the destination's origin hostname
 * (for example "work.example.com") is the honest structural meta line.
 * Falls back to the raw origin when it does not parse as a URL.
 */
function destinationHost(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return origin
  }
}

/**
 * Bottom-sheet vault (Web Projection) switcher for phones (design xPZVw).
 *
 * Display plus navigation only: the current projection is information
 * (washed row, inverted icon box, trailing Check, no link), each
 * destination is an ordinary anchor to its distinct HTTPS origin, and
 * there is no add-vault row. Open state stays with the caller — the
 * phone header brand and the drawer switcher each mount their own
 * instance, and those triggers are never reachable together, so the
 * instances cannot stack. Focus containment, Escape and overlay
 * dismissal, scroll lock, and focus return come from the registry
 * Sheet primitive.
 */
export function VaultSheet({
  current,
  destinations,
  open,
  onOpenChange,
}: {
  current: string
  destinations: ProjectionDestination[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-2 rounded-t-2xl bg-card px-4 pt-3 pb-6"
      >
        <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-border" />
        <div className="flex items-center justify-between">
          <SheetTitle className="text-sm font-semibold text-primary">Switch vault</SheetTitle>
          <SheetClose
            aria-label="Close vault switcher"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </SheetClose>
        </div>
        <ul aria-label="Switch vault" className="flex flex-col gap-2">
          <li
            aria-current="true"
            className="flex min-h-15 items-center gap-3 rounded-lg bg-muted p-3"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Archive aria-hidden="true" className="size-4 text-card" />
            </span>
            <span className="block min-w-0 flex-1 truncate text-sm font-medium text-primary">
              {current}
            </span>
            <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
          </li>
          {destinations.map((destination) => (
            <li key={destination.origin}>
              <a
                href={destination.origin}
                className="flex min-h-15 items-center gap-3 rounded-lg border border-border p-3"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Archive aria-hidden="true" className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-primary">
                    {destination.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {destinationHost(destination.origin)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  )
}
