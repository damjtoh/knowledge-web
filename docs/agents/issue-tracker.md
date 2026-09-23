# Issue tracker: Local Markdown

Issues and specs for this repository live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- The feature spec is `.scratch/<feature-slug>/spec.md`.
- Implementation issues are separate files under
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
- Triage state is a `Status:` line near the top of each issue file.
- Comments and conversation history append under a `## Comments` heading.

## Publishing and fetching

When a skill says to publish to the issue tracker, create the appropriate file
under `.scratch/<feature-slug>/`.

When a skill says to fetch an issue, read the referenced local Markdown file.

## Wayfinding operations

For a large effort, use `.scratch/<effort>/map.md` as the map and one child
file per ticket under `.scratch/<effort>/issues/`.

- Record the ticket type with `Type: research`, `prototype`, `grilling`, or
  `task`.
- Record state with `Status: claimed` or `Status: resolved`.
- Record dependencies with `Blocked by: NN, NN`.
- Claim the first open, unblocked, unclaimed ticket by number.
- Resolve a ticket by adding its result under `## Answer`, setting its status
  to `resolved`, and linking the result from the map.
