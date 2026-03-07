# OpenClaw Gateway Security and Hardening Best Practices

This document consolidates security and hardening best practices for the OpenClaw Gateway, drawing from official documentation and recent security advisories.

## 1. Core Security Model & Deployment Considerations

OpenClaw is designed primarily for a **personal assistant deployment model**, assuming one trusted operator per gateway. It is **not intended for multi-tenant environments** with untrusted or adversarial users. For such scenarios, run separate gateway instances for each trust boundary.

## 2. Hardened Baseline Configuration

For a secure starting point, consider the following configuration, which keeps the Gateway local, isolates DMs, and disables potentially dangerous tools by default:

```json
{
  "gateway": {
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "replace-with-long-random-token"
    }
  },
  "session": {
    "dmScope": "per-channel-peer"
  },
  "tools": {
    "profile": "messaging",
    "deny": ["group:automation", "group:runtime", "group:fs", "sessions_spawn", "sessions_send"],
    "fs": {
      "workspaceOnly": true
    },
    "exec": {
      "security": "deny",
      "ask": "always"
    }
  },
  "elevated": {
    "enabled": false
  },
  "channels": {
    "whatsapp": {
      "dmPolicy": "pairing",
      "groups": {
        "*": {
          "requireMention": true
        }
      }
    }
  }
}
```

## 3. Key Hardening Recommendations

### 3.1. Network Security

*   **Do Not Expose Publicly:** Never expose the OpenClaw gateway directly to the public internet. It typically runs on port 18789. Publicly exposed gateways are easily discoverable.
*   **Bind to Localhost:** Configure the gateway to listen only for connections from the local machine by binding it to `127.0.0.1` (localhost) or `loopback` in your `openclaw.json`.
*   **Firewall Rules:** Implement strict firewall rules to block all unnecessary inbound and outbound connections, allowing only essential traffic.
*   **Secure Remote Access:** For remote access, use secure methods like SSH tunneling or a VPN (e.g., Tailscale) instead of direct exposure.
*   **Docker Considerations:** If using Docker, be aware that it can bypass UFW rules. Configure rules in the `DOCKER-USER` chain to control exposure.

### 3.2. Authentication and Access Control

*   **Enable Gateway Authentication:** Always enable gateway authentication and use a strong, randomly generated authentication token. Generate a token with `openclaw doctor --generate-gateway-token`.
*   **Manage Access Tokens:** Treat your gateway authentication token like a password. Rotate it regularly and store it securely (e.g., as an environment variable, not in plaintext config files).
*   **Restrict Chat and Messaging:** If integrating with chat platforms, use allowlists to specify which user IDs can interact with your agent.
*   **Direct Messages (DMs) and Groups:**
    *   For DMs, use the default `pairing` policy (`dmPolicy: "pairing"`) to require approval for unknown senders.
    *   For group chats, require the bot to be explicitly mentioned to respond (`requireMention: true`).
    *   Isolate DM sessions using `session.dmScope: "per-channel-peer"` to prevent context leakage.

### 3.3. Isolation and Sandboxing

*   **Run in a Docker Container:** The recommended approach is to run OpenClaw within a Docker container for process isolation, filesystem restrictions, and network controls.
*   **Harden Docker Configuration:**
    *   Do not mount your home directory or the Docker socket.
    *   Use read-only filesystems where possible.
    *   Drop unnecessary Linux capabilities.
    *   Run the container as a non-root user.
*   **Enable Sandbox Mode:** For tasks that execute code, enable OpenClaw's sandbox mode to prevent malicious or compromised prompts from accessing your system or network. Configure this in `agents.defaults.sandbox`.

### 3.4. Credential and Secret Management

*   **Avoid Plaintext Storage:** Never store API keys, tokens, or other sensitive information in plaintext configuration files.
*   **Use Secure Storage Mechanisms:** Load credentials from environment variables or use dedicated secrets management solutions (e.g., Hashicorp Vault, AWS Secrets Manager).

### 3.5. File System Permissions

*   Ensure your configuration and state files are private.
*   `~/.openclaw/openclaw.json` should have permissions `600` (user read/write only).
*   The `~/.openclaw` directory should have permissions `700` (user access only).
*   `~/.openclaw/credentials/` and its contents should also be `600`.

### 3.6. Tool and Skill Security

*   **Principle of Least Privilege:** Only grant the agent the permissions and tools it absolutely needs.
*   **Audit Third-Party Skills:** Be extremely cautious with third-party skills, as they can contain malicious code. Research has shown a significant number of skills on marketplaces may be malicious.

### 3.7. Prompt Injection Mitigation

*   Lock down who can message the bot using DM pairing and allowlists.
*   Require mentions in group chats.
*   Run agents that process untrusted content in a sandbox with a minimal toolset.
*   Use the latest, most powerful models, as they are generally more resistant to prompt injection.

### 3.8. Monitoring and Incident Response

*   **Enable Logging:** Turn on comprehensive logging for all agent activities (command executions, API calls, file access). Store logs in a secure, separate location where the agent cannot modify them.
*   **Log Redaction:** Keep log redaction enabled (`logging.redactSensitive: "tools"`) to prevent sensitive information from leaking into logs.
*   **Incident Response Plan:** Have a plan for suspected compromises, including stopping the gateway and revoking API keys.

## 4. Staying Updated and Aware of Vulnerabilities

The OpenClaw project is under active development, and new vulnerabilities are discovered.

*   **Keep Software Updated:** Regularly update OpenClaw and its dependencies to ensure you have the latest security patches.
*   **Be Aware of Recent Threats:** Stay informed about new vulnerabilities. Notable past vulnerabilities include:
    *   **ClawJacked (High Severity):** Allowed malicious websites to hijack locally running OpenClaw instances via WebSocket connections and brute-force password. Patched in v2026.2.25.
    *   **Remote Code Execution (Critical - CVE-2026-25253):** A malicious link could trick the Control UI into sending an auth token to an attacker-controlled server, leading to RCE. Patched in v2026.1.29.
    *   **Authentication Bypass (High Severity - CVE-2026-26327):** Allowed attackers on the same local network to intercept credentials by spoofing a legitimate gateway.
    *   **Other Vulnerabilities:** Server-Side Request Forgery (SSRF - CVE-2026-26322), missing webhook authentication (CVE-2026-26319), and path traversal (CVE-2026-26329).

By diligently applying these practices, you can significantly enhance the security posture of your OpenClaw Gateway deployment.
