# 02 — Full-screen phone navigation drawer

**What to build:** A phone reader can open the published tree in a full-viewport drawer, find a page or Search, then return to reading without a cramped inline panel.

**Blocked by:** 01 — Desktop reader shell and published file tree.

**Status:** ready-for-agent

- [ ] The phone navigation fills the usable viewport width and height, respects safe areas, and gives long titles and deep branches readable space.
- [ ] A visible, labeled Close control and Escape dismiss the drawer; dismissing it returns focus to the opener. Focus remains in the drawer while it is open.
- [ ] The tree scrolls independently, essential controls remain reachable on short screens, and the article behind the drawer does not scroll.
- [ ] Selecting a page closes the drawer and opens the correct static URL; browser Back and refresh preserve real page history without adding drawer state to it.
- [ ] The drawer uses the same tree and Search dialog as desktop. Search stays accessible from the reading header while the drawer is closed, with the existing shortcut and focus behavior.
- [ ] Phone browser journeys cover touch-size controls, keyboard dismissal, focus return, deep navigation, overflow, and a narrow viewport; desktop navigation remains unaffected.
