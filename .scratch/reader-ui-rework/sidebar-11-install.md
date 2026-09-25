# sidebar-11 registry installation evidence (item 01)

Required starting point: registry-installed sidebar-11 for file tree and
inset. shadcn components exclusively for UI controls. Block sample data is
not product data.

## Command

From the repository root, with `reader/components.json` (style base-nova,
iconLibrary lucide) present:

```sh
printf 'y\ny\n' | ./reader/node_modules/.bin/shadcn add @shadcn/sidebar-11 -c reader -y -o
pnpm --dir reader add lucide-react
rm -rf reader/app/dashboard
```

`shadcn` version: 4.21.0 (reader devDependency). Registry: `@shadcn`.
Block: `@shadcn/sidebar-11` — "A sidebar with a collapsible file tree."

## Result

Created via CLI (registry, not hand-written):

- `reader/components/ui/sidebar.tsx` (SidebarProvider/Sidebar/SidebarHeader/
  SidebarContent/SidebarInset/SidebarTrigger, SidebarMenu, SidebarRail)
- `reader/components/ui/breadcrumb.tsx`
- `reader/components/ui/separator.tsx`
- `reader/components/ui/sheet.tsx` (mobile Sheet used by Sidebar)
- `reader/components/ui/skeleton.tsx`
- `reader/components/ui/tooltip.tsx`
- `reader/components/ui/input.tsx`
- `reader/hooks/use-mobile.ts`
- `reader/components/app-sidebar.tsx` (adapted; sample Changes/Files removed)
- `reader/components/ui/button.tsx` and `reader/components/ui/collapsible.tsx`
  normalized by Prettier to the repo style (no behavior change).

Removed sample product data:

- `reader/app/dashboard/page.tsx` (block sample page) deleted, not shipped.
- `reader/components/app-sidebar.tsx` sample `data.changes`/`data.tree`
  replaced with published navigation tree. Sample folder row single-expand
  action not used; reader keeps separate folder-page link and disclosure.

Added runtime icon dependency required by generated code:

- `lucide-react ^1.48.0` in `reader/package.json` (Folder, File,
  ChevronRight, Home, Search, PanelLeftIcon).

## Actual use (not dead files)

- `reader/components/reader-chrome.tsx` uses SidebarProvider, AppSidebar
  (Sidebar/SidebarHeader/SidebarContent/SidebarRail), SidebarInset,
  SidebarTrigger, Separator.
- `reader/components/app-sidebar.tsx` uses Sidebar, SidebarHeader,
  SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarRail.
- `reader/components/sidebar.tsx` uses SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarMenuSub with Collapsible and lucide icons as the
  published tree.

Existing CSS styles bespoke article typography and needed responsive
details only; sidebar layout comes from the registry components.
