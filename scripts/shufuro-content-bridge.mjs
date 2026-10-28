import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

async function findPacket(root, episode) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      const found = await findPacket(full, episode)
      if (found) return found
      continue
    }
    if (entry.isFile() && entry.name.startsWith(`${episode}_`) && entry.name.endsWith('.md')) return full
  }
  return null
}

function updatePacketFrontmatter(markdown, nextStatus) {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r?\n/)
  let fenceCount = 0
  let replaced = false
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      fenceCount += 1
      if (fenceCount >= 2) break
      continue
    }
    if (fenceCount === 1 && /^status:\s*/i.test(lines[i])) {
      lines[i] = `status: ${nextStatus}`
      replaced = true
      break
    }
  }
  if (!replaced) throw new Error('Packet frontmatter status field was not found.')
  return lines.join(eol)
}

function updateQueueRow(markdown, order, episode, fromStatus, toStatus) {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(/\r?\n/)
  let replaced = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.includes(`| ${order} |`) || !line.includes(`| ${episode} |`)) continue
    const cells = line.split('|')
    if (cells.length < 10) throw new Error(`Queue row for ${episode} is malformed.`)
    const statusIndex = cells.length - 2
    const current = cells[statusIndex].trim().toUpperCase()
    if (current === toStatus) return { markdown, changed: false }
    if (current !== fromStatus) throw new Error(`Queue row ${episode} is ${current}, expected ${fromStatus}.`)
    cells[statusIndex] = ` ${toStatus} `
    lines[i] = cells.join('|')
    replaced = true
    break
  }
  if (!replaced) throw new Error(`Queue row for ${episode} was not found.`)
  return { markdown: lines.join(eol), changed: true }
}

export async function promoteShufuroReview(task) {
  const meta = task?.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? task.metadata
    : {}
  const queuePath = meta.source_queue_path
  const episode = meta.source_ref
  const order = meta.source_order

  if (!queuePath || !episode || !order) throw new Error('Shufuro task is missing queue/source metadata.')
  if (String(meta.source_status || '').toUpperCase() !== 'REVIEW') {
    return { changed: false, episode, reason: 'source_not_review' }
  }

  const contentRoot = dirname(queuePath)
  const episodesRoot = join(contentRoot, 'Episodes')
  const packetPath = await findPacket(episodesRoot, episode)
  if (!packetPath) throw new Error(`Episode packet not found for ${episode}.`)

  const [queueBefore, packetBefore] = await Promise.all([
    readFile(queuePath, 'utf8'),
    readFile(packetPath, 'utf8'),
  ])

  const queueUpdate = updateQueueRow(queueBefore, order, episode, 'REVIEW', 'READY')
  const packetAfter = updatePacketFrontmatter(packetBefore, 'READY')

  await writeFile(packetPath, packetAfter, 'utf8')
  try {
    if (queueUpdate.changed) await writeFile(queuePath, queueUpdate.markdown, 'utf8')
  } catch (error) {
    await writeFile(packetPath, packetBefore, 'utf8').catch(() => undefined)
    throw error
  }

  return { changed: true, episode, order, packetPath, queuePath }
}
