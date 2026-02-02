// ClawdBot Gateway Interactions
export class ClawdBot {
  static async getSessions() {
    // This would typically come from a WebSocket or Gateway service
    // For now, return mock data that matches the expected structure
    return [
      {
        sessionId: 'main:jarv:2026-02-02-09-38-22',
        key: 'main:jarv:main',
        kind: 'main',
        started: Date.now() - (2 * 60 * 60 * 1000), // 2 hours ago
        model: 'anthropic/claude-3-5-haiku-latest',
        tokens: {
          used: 45000,
          total: 150000,
          percentage: 30
        },
        flags: ['persistent', 'core'],
        active: true,
        lastActivity: Date.now(),
        messageCount: 127
      },
      {
        sessionId: 'subagent:coding-task-857',
        key: 'subagent:coding:mission-control',
        kind: 'subagent',
        started: Date.now() - (30 * 60 * 1000), // 30 minutes ago
        model: 'groq/llama-3.3-70b-versatile',
        tokens: {
          used: 75000,
          total: 100000,
          percentage: 75
        },
        flags: ['task-specific', 'writing-code'],
        active: true,
        lastActivity: Date.now() - (10 * 60 * 1000),
        messageCount: 42
      },
      {
        sessionId: 'cron:daily-backup-2026-02-02',
        key: 'cron:system:daily-backup',
        kind: 'cron',
        started: Date.now() - (1 * 60 * 60 * 1000), // 1 hour ago
        model: 'groq/llama-3.1-8b-instant',
        tokens: {
          used: 5000,
          total: 50000,
          percentage: 10
        },
        flags: ['system', 'automated'],
        active: false,
        lastActivity: Date.now() - (45 * 60 * 1000),
        messageCount: 3
      }
    ]
  }
}