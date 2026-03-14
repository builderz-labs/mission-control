import { logger } from './logger'

const agents = ['Maestro', 'AdForge', 'JobForge']
const thoughts = [
  "Analyzing task tree...",
  "Loading related memory context...",
  "Running static analysis on the target repository...",
  "Validating architectural constraints...",
  "Checking for duplicate work in other branches...",
  "Optimizing execution strategy...",
]
const tools = [
  "grep_search(query: 'auth')",
  "view_file(path: 'src/lib/auth.ts')",
  "list_dir(path: 'src/components')",
  "run_command(command: 'npm run lint')",
]
const dialogue = [
  { agent: 'Maestro', msg: "I've reviewed the Master Plan for V20. AdForge, how is the tracking pixel implementation proceeding?" },
  { agent: 'AdForge', msg: "Pixel tracking is deployed. I am currently running A/B analysis on the conversion funnels.", thinking: "Loading A/B test results..." },
  { agent: 'JobForge', msg: "I need to align the open roles with the new pipeline capacity. Maestro, can you approve the new schema?" },
  { agent: 'Maestro', msg: "Approved. Proceeding to update the architecture documentation.", type: 'tool', msgContent: "write_to_file(path: 'doc/architecture.md')" },
  { agent: 'AdForge', msg: "I will update the ad copy to reflect the new feature set." },
]

let intervalHandle: NodeJS.Timeout | null = null

export function startVirtualOfficeSimulator() {
  if (intervalHandle) return

  const apiKey = process.env.API_KEY
  if (!apiKey) {
    logger.warn('Virtual Office Simulator: API_KEY not set, skipping')
    return
  }

  logger.info('Starting Virtual Office Simulator loop')
  let step = 0

  intervalHandle = setInterval(async () => {
    const rand = Math.random()

    let simulatedMsg: any = { type: 'text' }

    if (rand < 0.2) {
       simulatedMsg.agent = agents[Math.floor(Math.random() * agents.length)]
       simulatedMsg.message = '*working in background*'
       simulatedMsg.thinking = thoughts[Math.floor(Math.random() * thoughts.length)]
    } else if (rand > 0.9) {
       simulatedMsg.agent = agents[Math.floor(Math.random() * agents.length)]
       simulatedMsg.message = tools[Math.floor(Math.random() * tools.length)]
       simulatedMsg.type = 'tool'
    } else {
       const conv = dialogue[step % dialogue.length]
       simulatedMsg.agent = conv.agent
       simulatedMsg.message = conv.type === 'tool' ? conv.msgContent : conv.msg
       if (conv.thinking) simulatedMsg.thinking = conv.thinking
       if (conv.type) simulatedMsg.type = conv.type
       step++
    }

    try {
      await fetch('http://localhost:3000/api/virtual-office/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(simulatedMsg)
      })
    } catch (err) {
      logger.error({ err }, 'Simulator error')
    }

  }, 4500)
}

export function stopVirtualOfficeSimulator() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
