"use client"

import { useState } from "react"
import { Archive, Check, ChevronsUpDown } from "lucide-react"
import type { ProjectionDestination } from "../lib/site"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "./ui/sidebar"
import { VaultSheet } from "./vault-sheet"

/**
 * Current Web Projection switcher for the reader sidebar.
 *
 * The trigger always shows the current Web Projection, even when the owner
 * declared no destinations. The menu lists the current projection plus only
 * the explicitly declared cross-origin destinations, each as an ordinary
 * anchor to its distinct HTTPS origin: selecting one is a normal link
 * navigation, so browser history, access policy, offline copy, and install
 * identity remain per-origin. There is no add-projection or team action.
 * Utilities own trigger, brand, name, and choice visuals (44px floor,
 * truncate, wrapping, containment); hooks stay as non-visual DOM/test
 * selectors with only the menu max-width in scoped CSS. Keyboard operation
 * (open, move, Escape, focus return) comes from the registry DropdownMenu
 * primitive. On phones the same trigger button opens the VaultSheet bottom
 * sheet instead (design xPZVw); the desktop dropdown below is unchanged.
 */
export function ProjectionSwitcher({
  current,
  destinations,
}: {
  current: string
  destinations: ProjectionDestination[]
}) {
  const { isMobile } = useSidebar()
  const [sheetOpen, setSheetOpen] = useState(false)

  if (isMobile) {
    return (
      <SidebarMenu className="reader-projection-switcher mb-1 min-w-0 max-w-full">
        <SidebarMenuItem className="min-w-0 max-w-full">
          <SidebarMenuButton
            size="lg"
            className="reader-projection-trigger min-h-11"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Archive aria-hidden="true" className="size-4 text-card" />
            </span>
            <span className="reader-sidebar-brand reader-projection-name truncate min-w-0 max-w-full flex-1 text-left text-sm font-semibold wrap-break-word text-primary">
              {current}
            </span>
            <ChevronsUpDown
              aria-hidden="true"
              className="ml-auto size-4 shrink-0 text-muted-foreground"
            />
          </SidebarMenuButton>
          <VaultSheet
            current={current}
            destinations={destinations}
            open={sheetOpen}
            onOpenChange={setSheetOpen}
          />
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu className="reader-projection-switcher mb-1 min-w-0 max-w-full">
      <SidebarMenuItem className="min-w-0 max-w-full">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="reader-projection-trigger min-h-11"
            render={<SidebarMenuButton size="lg" />}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Archive aria-hidden="true" className="size-4 text-card" />
            </span>
            <span className="reader-sidebar-brand reader-projection-name truncate min-w-0 max-w-full flex-1 text-left text-sm font-semibold wrap-break-word text-primary">
              {current}
            </span>
            <ChevronsUpDown
              aria-hidden="true"
              className="ml-auto size-4 shrink-0 text-muted-foreground"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            className="reader-projection-menu min-w-48"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Web Projections</DropdownMenuLabel>
              <DropdownMenuItem
                disabled
                aria-current="true"
                className="reader-projection-current min-w-0 wrap-break-word"
              >
                <Check aria-hidden="true" />
                <span className="min-w-0 wrap-break-word">{current}</span>
              </DropdownMenuItem>
              {destinations.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  {destinations.map((destination) => (
                    <DropdownMenuItem
                      key={destination.origin}
                      className="reader-projection-choice min-w-0 wrap-break-word"
                      render={
                        <a
                          href={destination.origin}
                          className="reader-projection-link min-w-0 wrap-break-word"
                        />
                      }
                    >
                      <span className="min-w-0 wrap-break-word">{destination.name}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
