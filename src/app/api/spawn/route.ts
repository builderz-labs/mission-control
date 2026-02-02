import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
  try {
    const { task, model, label, timeoutSeconds } = await request.json()

    // Validate required fields
    if (!task || !model || !label) {
      return NextResponse.json(
        { error: 'Missing required fields: task, model, label' },
        { status: 400 }
      )
    }

    // Validate timeout
    const timeout = parseInt(timeoutSeconds) || 300
    if (timeout < 10 || timeout > 3600) {
      return NextResponse.json(
        { error: 'Timeout must be between 10 and 3600 seconds' },
        { status: 400 }
      )
    }

    // Generate spawn ID
    const spawnId = `spawn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Construct the spawn command
    // Using OpenClaw's sessions_spawn function via clawdbot CLI
    const command = `cd /home/ubuntu/clawd && clawdbot -c "sessions_spawn({
      task: ${JSON.stringify(task)},
      model: ${JSON.stringify(model)},
      label: ${JSON.stringify(label)},
      runTimeoutSeconds: ${timeout}
    })"`

    try {
      // Execute the spawn command
      const { stdout, stderr } = await execAsync(command, {
        timeout: 10000, // 10 second timeout for the spawn command itself
        cwd: '/home/ubuntu/clawd'
      })

      // Parse the response to extract session info
      let sessionInfo = null
      try {
        // Look for session information in stdout
        const sessionMatch = stdout.match(/Session created: (.+)/)
        if (sessionMatch) {
          sessionInfo = sessionMatch[1]
        }
      } catch (parseError) {
        console.error('Failed to parse session info:', parseError)
      }

      return NextResponse.json({
        success: true,
        spawnId,
        sessionInfo,
        task,
        model,
        label,
        timeoutSeconds: timeout,
        createdAt: Date.now(),
        stdout: stdout.trim(),
        stderr: stderr.trim()
      })

    } catch (execError: any) {
      console.error('Spawn execution error:', execError)
      
      return NextResponse.json({
        success: false,
        spawnId,
        error: execError.message || 'Failed to spawn agent',
        task,
        model,
        label,
        timeoutSeconds: timeout,
        createdAt: Date.now()
      }, { status: 500 })
    }

  } catch (error) {
    console.error('Spawn API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Get spawn history
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')

    // In a real implementation, you'd store spawn history in a database
    // For now, we'll try to read recent spawn activity from logs
    
    try {
      const { stdout } = await execAsync('cd /home/ubuntu/clawd && find logs/ -name "*.log" -mtime -1 | head -5 | xargs grep -h "sessions_spawn" | tail -20', {
        timeout: 5000
      })

      const spawnHistory = stdout.split('\n')
        .filter(line => line.trim())
        .slice(-limit)
        .map((line, index) => {
          try {
            // Parse log line to extract spawn info
            const timestampMatch = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)
            const modelMatch = line.match(/model[:\s]+"([^"]+)"/)
            const taskMatch = line.match(/task[:\s]+"([^"]+)"/)
            
            return {
              id: `history-${Date.now()}-${index}`,
              timestamp: timestampMatch ? new Date(timestampMatch[1]).getTime() : Date.now(),
              model: modelMatch ? modelMatch[1] : 'unknown',
              task: taskMatch ? taskMatch[1] : 'unknown',
              status: 'completed', // We can only see completed spawns in logs
              line: line.trim()
            }
          } catch (parseError) {
            return null
          }
        })
        .filter(Boolean)

      return NextResponse.json({ history: spawnHistory })

    } catch (logError) {
      // If we can't read logs, return empty history
      return NextResponse.json({ history: [] })
    }

  } catch (error) {
    console.error('Spawn history API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}