import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const messagesDir = path.resolve(process.cwd(), 'messages')

describe('task board locale coverage', () => {
  it('defines taskBoard.loadingTasks and taskBoard.taskBoard in every locale', () => {
    const localeFiles = fs.readdirSync(messagesDir).filter((name) => name.endsWith('.json'))

    for (const file of localeFiles) {
      const raw = fs.readFileSync(path.join(messagesDir, file), 'utf-8')
      const data = JSON.parse(raw) as Record<string, any>
      expect(data?.taskBoard?.loadingTasks, `${file} missing taskBoard.loadingTasks`).toBeTruthy()
      expect(data?.taskBoard?.taskBoard, `${file} missing taskBoard.taskBoard`).toBeTruthy()
    }
  })
})
