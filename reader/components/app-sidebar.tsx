"use client"

import { usePathname } from "next/navigation"
import { House, Search } from "lucide-react"
import type { NavigationNode } from "../lib/navigation"
import type { ProjectionDestination } from "../lib/site"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "./ui/sidebar"
import { ProjectionSwitcher } from "./projection-switcher"
import { Kbd } from "./ui/kbd"
import { Separator } from "./ui/separator"
import AppearanceControl from "./appearance-control"
import OfflineSave from "./offline-save"
import ReaderTree from "./sidebar"

/**
 * Desktop reader sidebar adapted from registry sidebar-11.
 *
 * Block sample Changes/Files data is not used: the header shows the
 * current Web Projection switcher (current plus only owner-declared
 * destinations) with Home and Search, and the scrollable content
 * is the published folder-and-note tree in metadata order. The registry
 * SidebarFooter holds appearance and offline status/actions, so the
 * sidebar bottom owns Light/Dark/System plus the explicit whole-
 * projection Save, progress, Ready, update Reload, retry, and named
 * Remove offline copy. Collapse uses
 * offcanvas so hiding removes the sidebar fully (no icon rail) and
 * restoring exposes the same mounted tree.
 */
export function AppSidebar({
  title,
  destinations,
  roots,
  onSearch,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  title: string
  destinations: ProjectionDestination[]
  roots: NavigationNode[]
  onSearch: (origin: HTMLElement | null) => void
}) {
  const pathname = usePathname() ?? "/"
  const isHome = pathname === "/"

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="gap-3 px-3 py-4">
        <ProjectionSwitcher current={title} destinations={destinations} />
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<a href="/" className="reader-sidebar-home" />}
              isActive={isHome}
              className="gap-2 rounded-md px-2.5 py-2"
            >
              <House aria-hidden="true" className="size-4 shrink-0 text-primary" />
              <span className="text-sm font-medium text-primary">Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="reader-search-trigger reader-search-sidebar gap-2 rounded-md px-2.5 py-2"
              onClick={(event) => {
                // SAFETY: SidebarMenuButton renders a button here, so currentTarget is that button element.
                onSearch(event.currentTarget as HTMLElement)
              }}
            >
              <Search aria-hidden="true" className="size-4 shrink-0 text-primary" />
              <span className="text-sm font-medium text-primary">Search</span>
              <Kbd className="ml-auto">⌘K</Kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <ReaderTree roots={roots} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="reader-sidebar-footer gap-4 border-t p-4">
        <OfflineSave />
        <Separator />
        <AppearanceControl />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
