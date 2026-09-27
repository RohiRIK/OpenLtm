# Comparison: how other tools solve long-term memory

This document answers [issue #10](https://github.com/RohiRIK/OpenLtm/issues/10) — a
request to show how the major memory tools solve the long-term-memory problem
differently, and how their **self-improvement** mechanisms compare.

**Verified 2026-09-27.** Star counts and project descriptions were read from each
project's GitHub repository on that date. Treat those as point-in-time facts; the
architectural columns describe durable design, but every project ships fast. Verify
anything load-bearing against the project's own docs before depending on it.

---

## The short version

Almost every tool in this space is a **store plus a retrieval function**. They
differ on three axes that actually matter:

1. **What shape is a memory?** A row, a vector, a graph node, a prose block.
2. **Who decides what becomes a memory?** The model, a rule engine, or you.
3. **What makes a stale memory go away?** Time, code changes, or a model rewrite.

That third axis is the one most discussions skip, and it is the one that decides
whether a memory store stays trustworthy after six months.

---

## Landscape

| | [OpenLTM](https://github.com/RohiRIK/OpenLtm) | [Mem0](https://github.com/mem0ai/mem0) | [Letta](https://github.com/letta-ai/letta) | [Graphiti](https://github.com/getzep/graphiti) / Zep | [LangMem](https://github.com/langchain-ai/langmem) | [Cognee](https://github.com/topoteretes/cognee) | [MCP `server-memory`](https://www.npmjs.com/package/@modelcontextprotocol/server-memory) |
|---|---|---|---|---|---|---|---|
| **Shape** | Structured row (id, category, importance, decay, provenance) in SQLite | Vector + optional graph, per namespace | Explicit memory *blocks* the agent edits, plus archival store | Temporal knowledge graph (entities + edges) | Semantic / episodic / procedural stores | Knowledge graph + vector | Knowledge graph: entities, relations, observations |
| **Write path** | Deterministic rule engine; LLM optional | LLM extraction + consolidation | The agent itself, via tools | LLM/heuristic entity + relation extraction | LLM "manager" in the background | LLM pipelines | The LLM calls `create_entities` etc. explicitly |
| **Retrieval** | FTS5 → optional vector → decay/rank | Vector similarity (+ filters) | Agent reads its own blocks; search over archival | Graph + semantic + temporal queries | Vector, keyword, or traversal | Graph + vector hybrid | `search_nodes` / `open_nodes` / `read_graph` |
| **Forgetting** | **Importance-weighted decay**, archival pass, janitor | Compaction / update loop | Agent rewrites blocks; sleep-time compute | Temporal validity windows | Background distillation | Pipelines | None — append-only unless the model deletes |
| **Self-improvement** | Signal-driven, no LLM required | LLM-driven consolidation | Agent self-edit | LLM edge resolution + enrichment | LLM distillation | LLM pipeline | None — the model is the judge |
| **Staleness from reality** | **Code-anchored**: a commit touching an anchored file flags the memory stale | No | No | No | No | No | No |
| **Audit trail** | Per-row provenance + `memory_audit` before/after | Update history | Block history | Temporal event log | No first-class | No | No |
| **Runs where** | Local, Bun + SQLite | Local or cloud | Local or cloud | Local or cloud | Local or cloud | Self-hosted | Local, Node, JSON file |
| **Host surface** | Claude Code, OpenCode, Pi, Hermes, OpenClaw, any MCP client | Library / platform | Library / platform | Library / platform | LangChain/LangGraph | Library / platform | Any MCP client |
| **Stars (2026-09-27)** | — | ~66.0k | ~24.9k | ~31.2k | ~1.7k | ~31.0k | ~90.6k (monorepo) |

---

## The systems in one paragraph each

### Mem0 — the memory *layer*
Positions itself as drop-in memory infrastructure for apps. Memories live in a
vector store (with an optional graph store) namespaced per user, session, or agent.
The differentiator is the **update loop**: when new input arrives, a model decides
whether it is a new memory, an update to an existing one, or noise. That is a
genuinely good idea — it stops near-duplicate accumulation — but it puts a model
in the write path, so behaviour depends on the model and the prompt.

### Letta — memory as agent state
Treats memory as the agent's own state rather than a sidecar. The agent is given
memory *blocks* (persona, human, task) that it can rewrite with tools, plus an
archival store it searches. Letta's own description is "stateful agents… that can
learn and self-improve over time," and the mechanism is literal: the model edits
its own memory. Extremely expressive, and correspondingly hard to constrain.

### Graphiti (from Zep) — temporal knowledge graphs
Optimises for *relationships over time*: facts have validity windows, so "Alice
works at Acme" and "Alice left Acme" both exist with timestamps. Ingestion extracts
entities and relations and uses a model to resolve edge meaning. Excellent for
reasoning over a changing world; heavier to run, and mostly Python-first.

### LangMem — library primitives
Part of the LangChain ecosystem, giving you semantic, episodic, and procedural
memory types plus a background "manager" that distils conversations into durable
memory. It is a set of building blocks rather than a product, so the self-improvement
behaviour is whatever you wire up.

### Cognee — self-hosted pipeline
A platform that ingests documents and conversations into a knowledge graph plus
vector index, driven by configurable pipelines. Strong when the source material is
documents; the write path is pipeline/LLM-driven.

### MCP `server-memory` — the reference implementation
The closest comparator to OpenLTM in *deployment* terms: local, no cloud, and
reachable from any MCP client. Its model is a plain knowledge graph — entities with
an `entityType` and a list of observations, plus directed relations. There is no
ranking, no decay, and no forgetting; the model is expected to decide what is worth
writing and when to delete it.

---

## Self-improvement: four genuinely different mechanisms

This is the heart of the issue, and the four approaches are not variations on a
theme — they trade against each other.

### A. LLM as the writer
**Mem0, LangMem, Cognee.** A model reads the conversation and emits memories,
deciding what is new, what updates something, and what is irrelevant.

- **Strength:** high recall of nuance; understands paraphrase and intent.
- **Cost:** every write is a model call, and behaviour drifts with the model.
- **Failure mode:** a model that is confidently wrong writes a confident memory.
  Nothing in the system can tell you it was wrong, because nothing else has a say.
- **Auditability:** you can log the call, but "why is this a memory?" resolves to
  "the model said so."

### B. Agent self-edit
**Letta.** The agent is given tools to rewrite its own memory blocks.

- **Strength:** the agent has full context, so it can notice "the user changed
  their mind" and revise rather than append.
- **Cost:** memory integrity is now coupled to agent behaviour. A confused agent
  corrupts its own memory.
- **Failure mode:** compounding drift — a bad rewrite is retrieved later and
  reinforces itself.
- **Auditability:** block history, if you keep it.

### C. Structure-first enrichment
**Graphiti/Zep.** Deterministic-ish extraction builds the graph shape; a model is
used to resolve edge semantics and to enrich.

- **Strength:** structure survives the model. Even if enrichment is imperfect, the
  entity/edge skeleton is inspectable and correctable.
- **Cost:** ingestion is heavier, and temporal reasoning has to be designed for.
- **Failure mode:** entity-resolution mistakes, which are expensive to unpick later.
- **Auditability:** strong — temporal validity windows are the audit trail.

### D. Deterministic signal-driven
**OpenLTM, and (in its simplest form) the MCP memory server.** No model decides
what is worth remembering. Writes come from an explicit `learn` call or a rule
engine; forgetting comes from signals the system can compute.

OpenLTM's specific signals:

| Signal | Mechanism |
|---|---|
| **Decay** | Importance-weighted: `importance 5` never decays; `1`–`3` fade with time and usage. The janitor refreshes scores in batch SQL and archives what is effectively dead. |
| **Reinforcement** | Re-learning the same fact increments `confirm_count` and raises confidence. Repeating something is the signal that it matters. |
| **Code-anchored staleness** | A memory can be anchored to the files it references. A commit touching one of those files flags it stale and demotes it, and the audit row records why. This is the axis nobody else has: **reality outside the conversation can invalidate a memory.** |
| **Supersede / conflict** | Typed relations mark one memory as replacing or contradicting another, instead of both living forever. |

- **Strength:** deterministic, testable, cheap, and fully auditable. Every stored
  row can be traced to an actor, a session, and a before/after snapshot.
- **Cost:** it will not infer nuance you never told it. A rule engine recognises
  "always / never / prefer / wrong", not "the thing the user was alluding to".
- **Failure mode:** under-collection rather than misinformation. You end up with
  fewer, truer memories instead of many, some of which are wrong.
- **Auditability:** complete by construction.

### Honest trade-off table

| | Determinism | Model calls on write | Catches paraphrase | Catches code drift | Audit trail |
|---|---|---|---|---|---|
| **A. LLM as writer** | low | yes | ✅ | ❌ | partial |
| **B. Agent self-edit** | low | yes | ✅ | ❌ | partial |
| **C. Structure-first** | medium | partly | ✅ | ❌ | strong |
| **D. Signal-driven** | high | no | ⚠️ | ✅ | complete |

These are not ranked. They answer different questions.

---

## What OpenLTM deliberately does not do

It is worth being explicit, because "missing features" read as oversights:

- **No autonomous memory writing.** Nothing learns unless a rule matches or a
  caller invokes `learn`. There is no background job rewriting your memory.
- **No LLM in the hot path.** Embedding providers are optional and disabled by
  default; without one you still get FTS5, ranking, decay, and the graph.
- **No cloud, no account, no telemetry.** The database is a file you own.
- **No vector store as a requirement.** sqlite-vec loads if a system SQLite with
  extension support is present; otherwise it degrades to FTS5 plus JS cosine.

The cost is real: OpenLTM will not capture a subtle preference you never stated
in a form the rules recognise. The benefit is that when it *is* wrong, you can
find out exactly why, and nothing rewrote your memory behind your back.

---

## Choosing one

- You want **maximum nuance recall** and can afford model calls and review →
  **Mem0** or **LangMem**.
- You want the **agent to own and revise its own memory** as part of its design →
  **Letta**.
- Your world **changes over time** and relationships matter more than facts →
  **Graphiti/Zep**.
- Your corpus is **documents** and you want a self-hosted graph → **Cognee**.
- You want a **local MCP memory with zero decisions to make** → the reference
  `server-memory`.
- You want **auditable memory that reacts to code changes**, works offline, and is
  the same database across every agent you run → **OpenLTM**.

---

## Keeping this document honest

Comparisons rot. If you spot something wrong:

1. Check the project itself rather than this table.
2. Open an issue with what is wrong and the date you checked — **star counts and
   feature claims are the first things to go stale**.
3. Prefer describing a mechanism over quoting a feature list; a mechanism is
   slower to change and more useful to a reader choosing a tool.
