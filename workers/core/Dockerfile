FROM node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573 AS node-runtime
FROM ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517
COPY --from=node-runtime /usr/local/ /usr/local/

ARG PNPM_VERSION=10.34.5
ARG NPM_VERSION=11.19.1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git libpcre2-8-0 python3 build-essential libstdc++6 libatomic1 && rm -rf /var/lib/apt/lists/*
RUN npm install -g "npm@${NPM_VERSION}" "pnpm@${PNPM_VERSION}" && npm cache clean --force
# Replace vulnerable pnpm-bundled packages with a locked dependency tree.
COPY workers/package-manager-patches/ /opt/mc-package-manager-patches/
RUN set -eu; pnpm --dir /opt/mc-package-manager-patches install --frozen-lockfile --ignore-scripts --ignore-workspace \
    && PATCH_PNPM_ROOT="$(npm root -g)/pnpm/dist/node_modules" \
    && for package in tar brace-expansion ip-address; do \
      rm -r "$PATCH_PNPM_ROOT/$package"; \
      ln -s "/opt/mc-package-manager-patches/node_modules/$package" "$PATCH_PNPM_ROOT/$package"; \
    done
RUN useradd --create-home --uid 10001 worker
COPY workers/*.mjs /opt/mc-worker/
USER worker
WORKDIR /home/worker
ENV MC_FLY_TRANSPORT=polled
ENTRYPOINT ["node", "/opt/mc-worker/polled.mjs"]

