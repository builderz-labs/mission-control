FROM python:3.12-slim

WORKDIR /app

# Install system dependencies + Node.js (for Claude CLI)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    openssh-client \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI (uses Max subscription, $0 API cost)
RUN npm install -g @anthropic-ai/claude-code

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data and wikis directories
RUN mkdir -p /app/data /app/wikis /root/.claude

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
