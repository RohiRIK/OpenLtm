---
type: llm
focus: trace
---

The mocked `collection` tool reports an existing `hosts` collection (key `host`; fields host, port, role with values db / web / proxmox / cache, notes).

Pass only if ALL of these hold:
1. The agent checked the existing collections (`collection` with action `list` or `describe`, name ends in `memory__collection`) before writing.
2. It stored the machines as records in the existing `hosts` collection with the `record` tool (name ends in `memory__record`, action `put`), one record per machine, with `role` values from the enum (`proxmox`, `cache`) and integer ports.
3. It did not define a new, near-duplicate collection (such as `servers`, `machines` or `lab_hosts`).
4. It did not also store the same facts as prose with `learn`.
5. The final message says the two machines were saved; it does not claim they were written to a file.
