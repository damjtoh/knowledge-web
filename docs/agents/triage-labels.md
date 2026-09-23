# Triage labels

The engineering skills use five canonical triage roles. Local issues store the
matching string in their `Status:` line.

| Canonical role    | Local status      | Meaning                                |
| ----------------- | ----------------- | -------------------------------------- |
| `needs-triage`    | `needs-triage`    | Maintainer must evaluate the issue     |
| `needs-info`      | `needs-info`      | Waiting for more information           |
| `ready-for-agent` | `ready-for-agent` | Fully specified and ready for an agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation          |
| `wontfix`         | `wontfix`         | Will not be implemented                |

When a skill requests a triage role, use the corresponding local status.
