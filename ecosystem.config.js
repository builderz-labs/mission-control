module.exports = {
  apps: [
    {
      name: 'mc-v2',
      script: 'npm',
      args: 'start',
      cwd: '/home/lucas/.openclaw/workspace/projects/mission-control-v2',
      env: {
        PORT: 3005,
        NODE_ENV: 'production',
      },
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
    },
  ],
}