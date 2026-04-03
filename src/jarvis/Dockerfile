FROM python:3.11-slim

WORKDIR /app

# System deps (minimal — no dev tools in production)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl gnupg && \
    rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Playwright chromium — needed by browser.py for web research
RUN playwright install chromium --with-deps

# Create non-root user with fixed UID for reproducible builds
RUN groupadd --gid 1001 jarvis && \
    useradd --uid 1001 --gid jarvis --shell /bin/bash --create-home jarvis

COPY . .

# Writable directories for runtime data and temp files
RUN mkdir -p /app/data /tmp/jarvis && \
    chown -R jarvis:jarvis /app /tmp/jarvis

# Playwright browser cache must be readable by the jarvis user
RUN chown -R jarvis:jarvis /home/jarvis

EXPOSE 8340

# Healthcheck against the unauthenticated health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:8340/api/health || exit 1

USER jarvis

CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8340"]
