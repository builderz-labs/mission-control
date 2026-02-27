import { NextResponse } from 'next/server'
import { ZodSchema, ZodError } from 'zod'
import { z } from 'zod'

export async function validateBody<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<{ data: T } | { error: NextResponse }> {
  try {
    const body = await request.json()
    const data = schema.parse(body)
    return { data }
  } catch (err) {
    if (err instanceof ZodError) {
      const messages = err.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
      return {
        error: NextResponse.json(
          { error: 'Validation failed', details: messages },
          { status: 400 }
        ),
      }
    }
    return {
      error: NextResponse.json({ error: 'Invalid request body' }, { status: 400 }),
    }
  }
}

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().max(5000).optional(),
  status: z.enum(['inbox', 'assigned', 'in_progress', 'review', 'done', 'blocked']).default('inbox'),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  assigned_to: z.string().max(100).optional(),
  created_by: z.string().max(100).optional(),
  due_date: z.number().optional(),
  estimated_hours: z.number().min(0).optional(),
  actual_hours: z.number().min(0).optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export const updateTaskSchema = createTaskSchema.partial()

export const createAgentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  role: z.string().min(1, 'Role is required').max(100).optional(),
  session_key: z.string().max(200).optional(),
  soul_content: z.string().max(50000).optional(),
  status: z.enum(['online', 'offline', 'busy', 'idle', 'error']).default('offline'),
  config: z.record(z.string(), z.unknown()).default({}),
  template: z.string().max(100).optional(),
  gateway_config: z.record(z.string(), z.unknown()).optional(),
  write_to_gateway: z.boolean().optional(),
})

export const createWebhookSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  url: z.string().url('Invalid URL'),
  events: z.array(z.string()).optional(),
  generate_secret: z.boolean().optional(),
})

export const createAlertSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(1000).optional(),
  entity_type: z.enum(['agent', 'task', 'session', 'activity']),
  condition_field: z.string().min(1).max(100),
  condition_operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'count_above', 'count_below', 'age_minutes_above']),
  condition_value: z.string().min(1).max(500),
  action_type: z.string().max(100).optional(),
  action_config: z.record(z.string(), z.unknown()).optional(),
  cooldown_minutes: z.number().min(1).max(10080).optional(),
})
