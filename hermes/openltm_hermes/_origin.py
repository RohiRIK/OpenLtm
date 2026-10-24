"""Where a memory's claim came from (memory-versus-authority, Phase 2).

Mirrors OpenLtm core's ``src/origin.ts``; test_origin.py keeps the two
identical. NULL on a row means it predates origin tracking (unknown).
"""

MEMORY_ORIGINS = ("owner-statement", "agent-observation", "external-source", "proposal", "historical-approval")
DEFAULT_ORIGIN = "agent-observation"
ORIGIN_PARAM_DESCRIPTION = (
    "Where this came from. owner-statement: the user said it directly in this conversation. "
    "agent-observation (default): your own inference or something you noticed. "
    "external-source: docs, web pages, tool or command output, code. "
    "historical-approval: a record that the user approved something once; it is not a standing permission. "
    "proposal: a candidate the user has not confirmed. When unsure, use agent-observation."
)
