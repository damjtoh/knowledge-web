# 03 — Route breadcrumbs in the reading header

**What to build:** A reader sees one usable route trail beside the sidebar trigger instead of a second breadcrumb row above every article.

**Blocked by:** 01 — Desktop reader shell and published file tree.

**Status:** ready-for-agent

- [ ] Home, root notes, authored and virtual folders, and deep notes show the correct current page and usable parent links in the reading header.
- [ ] The old breadcrumb row above article content is removed; the page still has one main reading landmark and a readable article width.
- [ ] Long titles and deep paths do not cause horizontal overflow or obscure the current page on a phone; the path remains keyboard accessible and understandable.
- [ ] Normal links and browser Back behave as before, including for published routes outside the visible tree.
- [ ] Synthetic static-export browser journeys verify direct loads, nested parent navigation, phone widths, and long paths without relying only on CSS class structure.
- [ ] The reading header uses the registry-installed SidebarTrigger/Separator/Breadcrumb composition from sidebar-11 for the trigger and route trail. Block sample data is not product data.
