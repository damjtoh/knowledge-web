# 01 — Desktop reader shell and published file tree

**What to build:** A desktop reader can hide and restore an app-style sidebar while browsing the same published folder-and-note tree beside a readable article. The existing phone Browse panel and offline footer continue to work until their replacement tickets land.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Home, authored notes, virtual folders, and direct deep links render inside one desktop sidebar-and-reading-area shell without losing their content or static routes.
- [ ] The sidebar header shows the current Web Projection and usable Home and Search controls; the reading header has a clear sidebar trigger.
- [ ] Hiding the sidebar gives the article more room and restoring it exposes the same tree; the article stays within a readable measure in both states.
- [ ] Published roots keep their declared order; folder and note routes are distinct and have restrained visual cues. The current page and ancestor branches remain clear.
- [ ] A folder name still opens its page while a separate disclosure control expands children without navigation. Several branches can remain open; session-open behavior, direct-link ancestors, and browser Back remain correct.
- [ ] Phone Browse, offline Save/update/remove, appearance, and Search remain usable during this transitional slice. No content API, extra publication data, or automatic offline download is introduced.
- [ ] A synthetic static Web Projection and desktop browser journey verify the visible behavior, including keyboard operation, long titles, and a collapsed sidebar.
- [ ] The desktop shell and file tree use registry-installed sidebar-11 as the required starting point (SidebarProvider/Sidebar/SidebarHeader/SidebarContent/SidebarInset/SidebarTrigger and SidebarMenu/Collapsible composition) with shadcn registry components for shell controls. Preserve bespoke article typography and needed responsive styling; do not hand-write a CSS sidebar. Block sample data is not product data.
