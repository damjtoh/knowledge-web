"use client"

import { Check, ChevronsUpDown } from "lucide-react"
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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar"

/**
 * Current Web Projection switcher for the reader sidebar.
 *
 * The trigger always shows the current Web Projection, even when the owner
 * declared no destinations. The menu lists the current projection plus only
 * the explicitly declared cross-origin destinations, each as an ordinary
 * anchor to its distinct HTTPS origin: selecting one is a normal link
 * navigation, so browser history, access policy, offline copy, and install
 * identity remain per-origin. There is no add-projection or team action.
 * Keyboard operation (open, move, Escape, focus return) comes from the
 * registry DropdownMenu primitive.
 */
export function ProjectionSwitcher({
  current,
  destinations,
}: {
  current: string
  destinations: ProjectionDestination[]
}) {
  return (
    <SidebarMenu className="reader-projection-switcher">
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="reader-projection-trigger"
            render={<SidebarMenuButton size="lg" />}
          >
            <span className="reader-sidebar-brand reader-projection-name">{current}</span>
            <ChevronsUpDown className="ml-auto" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="reader-projection-menu">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Web Projections</DropdownMenuLabel>
              <DropdownMenuItem disabled aria-current="true" className="reader-projection-current">
                <Check aria-hidden="true" />
                <span>{current}</span>
              </DropdownMenuItem>
              {destinations.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  {destinations.map((destination) => (
                    <DropdownMenuItem
                      key={destination.origin}
                      className="reader-projection-choice"
                      render={<a href={destination.origin} className="reader-projection-link" />}
                    >
                      <span>{destination.name}</span>
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
