// Run with: npx tsx src/workers/daemon.ts
import fetch from "node:fetch";
import os from "node:os";
import path from "node:path";

interface Agent {
  id: string;
  name: string;
  sessionKey: string;
}

const createHeaders = (apiKey?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return headers;
};

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

export async function fetchAgents(baseUrl: string, apiKey?: string): Promise<Agent[]> {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/agents`;
  const response = await fetch(endpoint, {
    headers: createHeaders(apiKey),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch agents: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Agent[] | undefined;
  return data ?? [];
}

export async function sendHeartbeat(
  agent: Agent,
  baseUrl: string,
  apiKey?: string,
): Promise<void> {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/agents/${agent.id}/heartbeat`;
  await fetch(endpoint, {
    method: "POST",
    headers: createHeaders(apiKey),
    body: JSON.stringify({
      id: agent.id,
      name: agent.name,
      sessionKey: agent.sessionKey,
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      workerPath: path.resolve(process.cwd(), "src/workers/daemon.ts"),
    }),
  });
}

async function main() {
  const baseUrl = process.env.MISSION_CONTROL_URL;
  const apiKey = process.env.MISSION_CONTROL_SERVICE_API_KEY;

  if (!baseUrl) {
    console.error("MISSION_CONTROL_URL is not set");
    process.exit(1);
  }

  const agents = await fetchAgents(baseUrl, apiKey);
  for (const agent of agents) {
    await sendHeartbeat(agent, baseUrl, apiKey);
  }

  console.log(
    `Sent heartbeats for ${agents.length} agent${agents.length === 1 ? "" : "s"} from ${os.hostname()}`,
  );
}

main().catch((error) => {
  console.error("Daemon worker failed", error);
  process.exit(1);
});
