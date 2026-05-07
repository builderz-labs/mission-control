# Minimal docker-compose wrapper.
#
# Usage:
#   make                         # rebuild + (re)start everything, prune orphans
#   make build [SERVICE...]      # build images (all, or specific services)
#   make up    [SERVICE...]      # start services
#   make down                    # stop all
#   make restart [SERVICE...]    # restart
#   make logs  [SERVICE...]      # follow logs (Ctrl+C to stop)
#   make ps                      # list running services
#   make clean                   # down + prune orphan containers, dangling images, unused volumes
#
# Mode:
#   MODE=dev  (default) — uses docker-compose-dev.yml + docker-compose-openclaw.yml
#   MODE=prod          — uses docker-compose.yml     + docker-compose-openclaw.yml
#
#   make MODE=prod up
#
# Service args are positional and forwarded to docker compose:
#   make logs openclaw-gateway
#   make build mission-control-dev gpu-coordinator-proxy
#   make restart ollama
#
# Old recipes (openclaw-pair-mc, openclaw-update, etc.) live in Makefile.legacy.
# Include them only if you actually need them: `make -f Makefile.legacy <target>`.

MODE ?= dev

ifeq ($(MODE),prod)
  COMPOSE_FILES := -f docker-compose.yml -f docker-compose-openclaw.yml
else
  COMPOSE_FILES := -f docker-compose-dev.yml -f docker-compose-openclaw.yml
endif

# Auto-detect the host's docker socket gid so the dev container's group_add
# matches whatever the host actually has (994 on stock Debian/Ubuntu, but
# varies on Fedora/Arch/colima/Rancher Desktop). Override on the command
# line: `DOCKER_SOCKET_GID=999 make up`. Falls back to 994 if the socket
# isn't readable.
DOCKER_SOCKET_GID ?= $(shell stat -c %g /var/run/docker.sock 2>/dev/null || echo 994)
export DOCKER_SOCKET_GID

DC := docker compose $(COMPOSE_FILES)

# Everything after the first goal is treated as service args, not as targets.
# `make build openclaw-gateway` → first goal `build`, args=`openclaw-gateway`.
ARGS := $(filter-out $(firstword $(MAKECMDGOALS)),$(MAKECMDGOALS))

.DEFAULT_GOAL := all

.PHONY: all build up down restart logs ps clean help build-extra-images

help:  ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-z][a-zA-Z0-9_-]*:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "  Mode: MODE=$(MODE)  (override with MODE=prod)"
	@echo "  Compose files: $(COMPOSE_FILES)"

all:  ## Default: prune orphans, rebuild images, recreate everything, show ps
	@echo "==> [1/4] stopping running stack and pruning orphans"
	-$(DC) down --remove-orphans
	@echo ""
	@echo "==> [2/4] building images"
	$(DC) build --pull $(ARGS)
	@$(MAKE) -s build-extra-images
	@echo ""
	@echo "==> [3/4] starting services"
	$(DC) up -d --remove-orphans $(ARGS)
	@echo ""
	@echo "==> [4/4] status"
	$(DC) ps

build:  ## Build images. Usage: make build [SERVICE...]
	$(DC) build --pull $(ARGS)
	@$(MAKE) -s build-extra-images

# Standalone images that are NOT in any compose file but are needed at runtime
# (e.g. the sandbox image that openclaw spawns from .openclaw-data/openclaw.json
# settings, not from a compose service). Bootstraps the upstream
# openclaw-sandbox:bookworm-slim base via openclaw-src/scripts/sandbox-setup.sh
# if missing, then overlays brew via Dockerfile.openclaw.sandbox.
build-extra-images:
	@if ! docker image inspect openclaw-sandbox:bookworm-slim >/dev/null 2>&1; then \
	  if [ -x openclaw-src/scripts/sandbox-setup.sh ]; then \
	    echo "==> bootstrapping openclaw-sandbox:bookworm-slim (upstream)"; \
	    bash openclaw-src/scripts/sandbox-setup.sh; \
	  else \
	    echo "WARN: openclaw-src/scripts/sandbox-setup.sh missing; skipping sandbox base"; \
	  fi; \
	fi
	@if [ -f Dockerfile.openclaw.sandbox ]; then \
	  echo "==> building mc-openclaw-sandbox:brew (overlays brew on the upstream sandbox)"; \
	  docker build -t mc-openclaw-sandbox:brew -f Dockerfile.openclaw.sandbox .; \
	fi
	@if [ -f Dockerfile.openclaw.dockercli ]; then \
	  echo "==> building mc-openclaw:dockercli (gateway image with docker CLI + brew)"; \
	  docker build -t mc-openclaw:dockercli -f Dockerfile.openclaw.dockercli .; \
	fi

up:  ## Start services. Usage: make up [SERVICE...]
	$(DC) up -d --remove-orphans $(ARGS)

down:  ## Stop and remove all services
	$(DC) down --remove-orphans

restart:  ## Restart services. Usage: make restart [SERVICE...]
	$(DC) restart $(ARGS)

logs:  ## Follow logs. Usage: make logs [SERVICE...]
	$(DC) logs -f --tail=100 $(ARGS)

ps:  ## Show running services
	$(DC) ps

clean:  ## Down + prune dangling images, unused volumes, leftover containers
	-$(DC) down --remove-orphans --volumes
	-docker container prune -f
	-docker image prune -f
	-docker volume prune -f

# Catch-all so positional args like `make logs openclaw-gateway` don't
# print "No rule to make target 'openclaw-gateway'".
%:
	@:
