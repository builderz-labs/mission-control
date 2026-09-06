FROM mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48

ARG CODEX_VERSION
ARG CLAUDE_CODE_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git jq procps && rm -rf /var/lib/apt/lists/*
RUN test -n "$CODEX_VERSION" && test -n "$CLAUDE_CODE_VERSION" && npm install -g "@openai/codex@${CODEX_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
COPY workers/entrypoint.sh /usr/local/bin/mc-worker
RUN chmod 755 /usr/local/bin/mc-worker && useradd --create-home --uid 10001 worker
USER worker
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/mc-worker"]
