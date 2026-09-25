"use client"

import { Home, Search } from "lucide-react"
import type { NavigationNode } from "../lib/navigation"
import type { ProjectionDestination } from "../lib/site"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "./ui/sidebar"
import { ProjectionSwitcher } from "./projection-switcher"
import ReaderTree from "./sidebar"

/**
 * Desktop reader sidebar adapted from registry sidebar-11.
 *
 * Block sample Changes/Files data is not used: the header shows the
 * current Web Projection switcher (current plus only owner-declared
 * destinations) with Home and Search, and the scrollable content
 * is the published folder-and-note tree in metadata order. Collapse uses
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
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <ProjectionSwitcher current={title} destinations={destinations} />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<a href="/" className="reader-sidebar-home" />}>
              <Home aria-hidden="true" />
              <span>Home</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="reader-search-trigger reader-search-sidebar"
              onClick={(event) => {
                // SAFETY: SidebarMenuButton renders a button here, so currentTarget is that button element.
                onSearch(event.currentTarget as HTMLElement)
              }}
            >
              <Search aria-hidden="true" />
              <span>Search</span>
              <kbd aria-hidden="true" className="ml-auto">
                ⌘K
              </kbd>
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
      <SidebarRail />
    </Sidebar>
  )
}
