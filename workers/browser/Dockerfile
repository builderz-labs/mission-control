FROM mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48

# Command worker browser setup supports Chromium; omit unused media codecs.
RUN apt-get purge -y gstreamer1.0-plugins-bad libgstreamer-plugins-bad1.0-0
ARG PNPM_VERSION=10.34.5
ARG NPM_VERSION=11.19.1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git openssh-client libpcre2-8-0 python3 build-essential && rm -rf /var/lib/apt/lists/*
RUN npm install -g "npm@${NPM_VERSION}" "pnpm@${PNPM_VERSION}" && npm cache clean --force
# Replace vulnerable pnpm-bundled packages with a locked dependency tree.
COPY workers/package-manager-patches/ /opt/mc-package-manager-patches/
RUN set -eu; pnpm --dir /opt/mc-package-manager-patches install --frozen-lockfile --ignore-scripts --ignore-workspace \
    && PATCH_PNPM_ROOT="$(npm root -g)/pnpm/dist/node_modules" \
    && for package in tar brace-expansion ip-address; do \
      rm -r "$PATCH_PNPM_ROOT/$package"; \
      ln -s "/opt/mc-package-manager-patches/node_modules/$package" "$PATCH_PNPM_ROOT/$package"; \
    done
COPY workers/*.mjs /opt/mc-worker/
RUN useradd --create-home --uid 10001 worker \
    && mkdir -p /home/worker/.cache/ms-playwright \
    && for browser in /ms-playwright/*; do ln -s "$browser" /home/worker/.cache/ms-playwright/; done \
    && chown -hR worker:worker /home/worker/.cache
ENV PLAYWRIGHT_BROWSERS_PATH=/home/worker/.cache/ms-playwright
USER worker
WORKDIR /home/worker
ENV MC_FLY_TRANSPORT=polled
ENTRYPOINT ["node", "/opt/mc-worker/polled.mjs"]

