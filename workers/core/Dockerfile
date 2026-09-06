FROM node:24.18.0-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

ARG CODEX_VERSION
ARG CLAUDE_CODE_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git jq procps && rm -rf /var/lib/apt/lists/*
RUN test -n "$CODEX_VERSION" && test -n "$CLAUDE_CODE_VERSION" && npm install -g "@openai/codex@${CODEX_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
RUN useradd --create-home --uid 10001 worker
COPY workers/entrypoint.sh /usr/local/bin/mc-worker
RUN chmod 755 /usr/local/bin/mc-worker
USER worker
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/mc-worker"]
