# Canonical vocabulary

Terms used consistently across the Knowledge Web Publisher, its adopters, and
the platform documentation. The vocabulary distinguishes repository ownership,
read-only publication, and future interactive applications so a subject does
not accidentally become an access boundary.

## New terms

| Term                        | Definition                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Knowledge Base**          | A generic, independent canonical Markdown repository (for example a trip vault or a training vault). The generic term for any repository the Publisher can project.                                                                       |
| **Web Projection**          | An optional, read-only static representation of selected Knowledge Base content, produced by the Publisher. A Web Projection is neither Canonical Knowledge nor a Vault Editor; it is derived and disposable, never a writable authority. |
| **Knowledge Web Publisher** | The shared, versioned build machinery in this repository that converts a Publication Manifest plus selected Markdown into a Web Projection.                                                                                               |
| **Publication Manifest**    | The small per-Knowledge-Base declaration of site title, canonical hostname, and explicitly allowlisted content roots and files.                                                                                                           |
| **Allowlist**               | The explicit set of content roots and files named in the Publication Manifest. It is the publication authority: anything outside it never enters the generated site or the runtime image.                                                 |
| **Access Partition**        | The human audience and access policy governing one ordinary Knowledge Vault. It is an ownership boundary, not a subject or Specialist boundary.                                                                                           |
| **Domain App**              | A future interactive product over one or more authorized Knowledge Vault contracts. It is not a second canonical content store.                                                                                                           |

## Platform terms

| Term                    | Meaning (unchanged)                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Knowledge Vault**     | An ordinary Git-backed Knowledge Base governed by one human Access Partition. Damian, Shared, and future Micaela vaults are named instances; subjects remain collections inside them. |
| **Canonical Knowledge** | The authoritative knowledge stored in Knowledge Base repositories. Web Projections never become canonical.                                                                            |
| **Vault Editor**        | The online editable surface bound to one Knowledge Vault. Web Projections are read-only and never replace or proxy an editor.                                                         |
| **Front Door**          | The assistant's entry point (for example Telegram). Unchanged.                                                                                                                        |
| **Specialist**          | A scoped assistant capability that answers from a defined knowledge boundary. Unchanged.                                                                                              |
| **Service Slot**        | The established deployment slot (for example Dokploy) each Web Projection uses. Unchanged.                                                                                            |
| **Routing Chain**       | The established traffic path (Cloudflare, tunnel, reverse proxy, service slot). Web Projections are added to it; it is not redefined.                                                 |
| **Secrets Backplane**   | The secret management system (Doppler). Identity and proxy credentials flow through it, never through repositories. Unchanged.                                                        |
| **Validation Loop**     | The fmt → validate → plan ritual for infrastructure changes. Unchanged.                                                                                                               |

## Ownership boundaries

- Content repositories own their publication decision and pinned Publisher
  revision.
- The Publisher owns rendering behavior and the manifest contract.
- Infrastructure owns Routing Chain, access policy, and Service Slot
  configuration.
- The Publisher is public and generic; private content lives only in its own
  content-specific build and final application image.
