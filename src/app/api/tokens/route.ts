import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, access } from 'fs/promises'
import { join } from 'path'

const DATA_PATH = '/home/ubuntu/clawd/.ralph/mission-control-tokens.json'

interface TokenUsageRecord {
  id: string
  model: string
  sessionId: string
  timestamp: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  operation: string
  duration?: number
}

interface TokenStats {
  totalTokens: number
  totalCost: number
  requestCount: number
  avgTokensPerRequest: number
  avgCostPerRequest: number
}

interface ExportData {
  usage: TokenUsageRecord[]
  summary: TokenStats
  models: Record<string, TokenStats>
  sessions: Record<string, TokenStats>
}

// Model pricing (cost per 1K tokens)
const MODEL_PRICING: Record<string, number> = {
  'anthropic/claude-3-5-haiku-latest': 0.25,
  'anthropic/claude-sonnet-4-20250514': 3.0,
  'anthropic/claude-opus-4-5': 15.0,
  'groq/llama-3.1-8b-instant': 0.05,
  'groq/llama-3.3-70b-versatile': 0.59,
  'moonshot/kimi-k2.5': 1.0,
  'minimax/minimax-m2.1': 0.3,
  'ollama/deepseek-r1:14b': 0.0, // Local model - free
}

// Helper function to get cost from model name
function getModelCost(modelName: string): number {
  // Try exact match first
  if (MODEL_PRICING[modelName]) {
    return MODEL_PRICING[modelName]
  }
  
  // Try partial match
  for (const [model, cost] of Object.entries(MODEL_PRICING)) {
    if (modelName.includes(model.split('/').pop() || '')) {
      return cost
    }
  }
  
  // Default cost for unknown models
  return 1.0
}

async function loadTokenData(): Promise<TokenUsageRecord[]> {
  try {
    await access(DATA_PATH)
    const data = await readFile(DATA_PATH, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    // File doesn't exist or is corrupted, return empty array
    return []
  }
}

async function saveTokenData(data: TokenUsageRecord[]): Promise<void> {
  await writeFile(DATA_PATH, JSON.stringify(data, null, 2))
}

function calculateStats(records: TokenUsageRecord[]): TokenStats {
  if (records.length === 0) {
    return {
      totalTokens: 0,
      totalCost: 0,
      requestCount: 0,
      avgTokensPerRequest: 0,
      avgCostPerRequest: 0
    }
  }

  const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0)
  const totalCost = records.reduce((sum, r) => sum + r.cost, 0)
  const requestCount = records.length

  return {
    totalTokens,
    totalCost,
    requestCount,
    avgTokensPerRequest: Math.round(totalTokens / requestCount),
    avgCostPerRequest: totalCost / requestCount
  }
}

function filterByTimeframe(records: TokenUsageRecord[], timeframe: string): TokenUsageRecord[] {
  const now = Date.now()
  let cutoffTime: number

  switch (timeframe) {
    case 'hour':
      cutoffTime = now - (60 * 60 * 1000)
      break
    case 'day':
      cutoffTime = now - (24 * 60 * 60 * 1000)
      break
    case 'week':
      cutoffTime = now - (7 * 24 * 60 * 60 * 1000)
      break
    case 'month':
      cutoffTime = now - (30 * 24 * 60 * 60 * 1000)
      break
    case 'all':
    default:
      return records
  }

  return records.filter(record => record.timestamp >= cutoffTime)
}

function generateMockData(): TokenUsageRecord[] {
  const mockData: TokenUsageRecord[] = []
  const models = ['anthropic/claude-sonnet-4-20250514', 'groq/llama-3.3-70b-versatile', 'anthropic/claude-3-5-haiku-latest', 'ollama/deepseek-r1:14b']
  const operations = ['chat_completion', 'summarization', 'code_generation', 'analysis', 'spawn_agent']
  const sessions = ['main', 'subagent-1', 'subagent-2', 'cron-task', 'memory-search']
  
  const now = Date.now()
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000)
  
  for (let i = 0; i < 200; i++) {
    const model = models[Math.floor(Math.random() * models.length)]
    const timestamp = sevenDaysAgo + Math.random() * (now - sevenDaysAgo)
    const inputTokens = Math.floor(Math.random() * 2000) + 100
    const outputTokens = Math.floor(Math.random() * 1000) + 50
    const totalTokens = inputTokens + outputTokens
    const costPer1k = getModelCost(model)
    const cost = (totalTokens / 1000) * costPer1k
    
    mockData.push({
      id: `mock-${i}`,
      model,
      sessionId: sessions[Math.floor(Math.random() * sessions.length)],
      timestamp,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      operation: operations[Math.floor(Math.random() * operations.length)],
      duration: Math.floor(Math.random() * 5000) + 500
    })
  }
  
  return mockData.sort((a, b) => b.timestamp - a.timestamp)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'list'
    const timeframe = searchParams.get('timeframe') || 'all'
    const format = searchParams.get('format') || 'json'

    let tokenData = await loadTokenData()
    
    // If no real data exists, use mock data for development
    if (tokenData.length === 0) {
      tokenData = generateMockData()
    }

    // Filter by timeframe
    const filteredData = filterByTimeframe(tokenData, timeframe)

    if (action === 'list') {
      return NextResponse.json({
        usage: filteredData.slice(0, 100), // Latest 100 records
        total: filteredData.length,
        timeframe
      })
    }

    if (action === 'stats') {
      const overallStats = calculateStats(filteredData)
      
      // Group by model
      const modelStats: Record<string, TokenStats> = {}
      const modelGroups = filteredData.reduce((acc, record) => {
        if (!acc[record.model]) acc[record.model] = []
        acc[record.model].push(record)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)
      
      Object.entries(modelGroups).forEach(([model, records]) => {
        modelStats[model] = calculateStats(records)
      })
      
      // Group by session
      const sessionStats: Record<string, TokenStats> = {}
      const sessionGroups = filteredData.reduce((acc, record) => {
        if (!acc[record.sessionId]) acc[record.sessionId] = []
        acc[record.sessionId].push(record)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)
      
      Object.entries(sessionGroups).forEach(([sessionId, records]) => {
        sessionStats[sessionId] = calculateStats(records)
      })

      return NextResponse.json({
        summary: overallStats,
        models: modelStats,
        sessions: sessionStats,
        timeframe,
        recordCount: filteredData.length
      })
    }

    if (action === 'export') {
      const overallStats = calculateStats(filteredData)
      
      const modelStats: Record<string, TokenStats> = {}
      const sessionStats: Record<string, TokenStats> = {}
      
      // Calculate model and session stats
      const modelGroups = filteredData.reduce((acc, record) => {
        if (!acc[record.model]) acc[record.model] = []
        acc[record.model].push(record)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)
      
      Object.entries(modelGroups).forEach(([model, records]) => {
        modelStats[model] = calculateStats(records)
      })
      
      const sessionGroups = filteredData.reduce((acc, record) => {
        if (!acc[record.sessionId]) acc[record.sessionId] = []
        acc[record.sessionId].push(record)
        return acc
      }, {} as Record<string, TokenUsageRecord[]>)
      
      Object.entries(sessionGroups).forEach(([sessionId, records]) => {
        sessionStats[sessionId] = calculateStats(records)
      })

      const exportData: ExportData = {
        usage: filteredData,
        summary: overallStats,
        models: modelStats,
        sessions: sessionStats
      }

      if (format === 'csv') {
        // Convert to CSV format
        const headers = ['timestamp', 'model', 'sessionId', 'operation', 'inputTokens', 'outputTokens', 'totalTokens', 'cost', 'duration']
        const csvRows = [headers.join(',')]
        
        filteredData.forEach(record => {
          const row = [
            new Date(record.timestamp).toISOString(),
            record.model,
            record.sessionId,
            record.operation,
            record.inputTokens,
            record.outputTokens,
            record.totalTokens,
            record.cost.toFixed(4),
            record.duration || 0
          ]
          csvRows.push(row.join(','))
        })

        return new NextResponse(csvRows.join('\n'), {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename=token-usage-${timeframe}-${new Date().toISOString().split('T')[0]}.csv`
          }
        })
      }

      return NextResponse.json(exportData, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename=token-usage-${timeframe}-${new Date().toISOString().split('T')[0]}.json`
        }
      })
    }

    if (action === 'trends') {
      // Calculate hourly trends for the last 24 hours
      const now = Date.now()
      const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000)
      const recentData = filteredData.filter(r => r.timestamp >= twentyFourHoursAgo)
      
      const hourlyTrends: Record<string, { tokens: number; cost: number; requests: number }> = {}
      
      recentData.forEach(record => {
        const hour = new Date(record.timestamp).toISOString().slice(0, 13) + ':00:00.000Z'
        if (!hourlyTrends[hour]) {
          hourlyTrends[hour] = { tokens: 0, cost: 0, requests: 0 }
        }
        hourlyTrends[hour].tokens += record.totalTokens
        hourlyTrends[hour].cost += record.cost
        hourlyTrends[hour].requests += 1
      })
      
      const trends = Object.entries(hourlyTrends)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([timestamp, data]) => ({
          timestamp,
          ...data
        }))

      return NextResponse.json({ trends, timeframe })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Tokens API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { model, sessionId, inputTokens, outputTokens, operation = 'chat_completion', duration } = body

    if (!model || !sessionId || typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const totalTokens = inputTokens + outputTokens
    const costPer1k = getModelCost(model)
    const cost = (totalTokens / 1000) * costPer1k

    const record: TokenUsageRecord = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      model,
      sessionId,
      timestamp: Date.now(),
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      operation,
      duration
    }

    const existingData = await loadTokenData()
    existingData.unshift(record) // Add to beginning (newest first)
    
    // Keep only last 10,000 records to prevent file from growing too large
    if (existingData.length > 10000) {
      existingData.splice(10000)
    }

    await saveTokenData(existingData)

    return NextResponse.json({ success: true, record })
  } catch (error) {
    console.error('Error saving token usage:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}