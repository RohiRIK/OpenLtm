# MCP stdio server image for Glama / container hosts.
# Pin matches the Bun 1.4.4 release used in this environment; the repo does not
# set packageManager or engines, and CI installs setup-bun@latest.
FROM oven/bun:1.4.4

WORKDIR /app

# Workspace install needs the root manifest, the lockfile, and every packages/*
# package.json. Source is included so `bun …/bin.ts mcp-serve` can run unbuilt.
COPY package.json bun.lock ./
COPY packages ./packages

# Skip the repo postinstall (hook wiring). Runtime does not need it.
USER root
RUN bun install --frozen-lockfile --ignore-scripts \
  && chown -R bun:bun /app

USER bun

# Names verified in packages/openltm-core (paths.ts, embeddings/config, extensions.ts).
# disabled embeddings + both native loaders off: no network or secrets at start.
ENV LTM_DB_PATH=/tmp/openltm.db \
    LTM_EMBED_PROVIDER=disabled \
    LTM_DISABLE_VEC=1 \
    LTM_DISABLE_HONKER=1

CMD ["bun", "packages/openltm-core/src/cli/bin.ts", "mcp-serve"]
