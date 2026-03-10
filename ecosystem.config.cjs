module.exports = {
  apps: [
    {
      name: 'mission-control',
      cwd: __dirname,
      script: 'node_modules/next/dist/bin/next',
      args: 'start --hostname 0.0.0.0 --port 3005',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        HOSTNAME: '0.0.0.0',
        PORT: '3005',
      },
    },
  ],
}
