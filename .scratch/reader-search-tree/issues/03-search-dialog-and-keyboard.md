# 03 — Search dialog and keyboard journey

**What to build:** One Search dialog for desktop and phone: a visible control
in the desktop sidebar and phone header, plus Command+K / Control+K. Results,
loading, empty, and no-results states; keyboard selection; Escape with focus
return to the control focused before opening.

**Blocked by:** 01 — Tree sidebar on desktop and phone; 02 — Search index and
static export safety.

**Status:** ready-for-agent

- [x] A visible, labeled Search control opens the dialog from the desktop sidebar and phone header.
- [x] Command+K and Control+K open or focus the dialog on both layouts.
- [x] Typing shows ranked results with title, location, and excerpt; loading, empty, and no-results states are announced accessibly.
- [x] Type, arrow through results, open a result, and close work entirely by keyboard; opening a result navigates to its static route.
- [x] Escape closes the dialog and focus returns to the control focused before it opened.
- [x] Official shadcn registry/CLI Dialog component is used; styling matches the existing reader interface in both appearances.
- [x] Reader browser journeys cover the search dialog at desktop and phone widths.
