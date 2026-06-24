#!/usr/bin/env node
/**
 * post-atlas-brief.cjs — fetch the atlas-brief and post it to Slack.
 *
 * Designed to be cron-scheduled on the VPS at 08:00 BST (07:00 UTC May–Oct).
 *
 *   crontab -e
 *   0 7 * * * /usr/bin/node /opt/mission-control/scripts/post-atlas-brief.cjs >> /var/log/atlas-brief.log 2>&1
 *
 * Env required:
 *   SLACK_WEBHOOK_URL  (or SLACK_BOT_TOKEN + SLACK_CHANNEL_ID)
 *   MC_URL             default http://127.0.0.1:4000
 *   MC_API_KEY         required (production key in HETZNER_PRODUCTION.md)
 *   BRIEF_ROLE         gerda (default) | kris | arianne
 *
 * Exit codes:
 *   0  posted
 *   1  brief fetch failed
 *   2  Slack post failed
 *   3  missing required env
 */

const { request } = require('node:https')
const httpReq = require('node:http').request

function fetchBrief() {
  const mcUrl = (process.env.MC_URL || 'http://127.0.0.1:4000').replace(/\/$/, '')
  const role = process.env.BRIEF_ROLE || 'gerda'
  const apiKey = process.env.MC_API_KEY
  if (!apiKey) {
    console.error('FATAL: MC_API_KEY env var not set')
    process.exit(3)
  }
  const url = new URL(`${mcUrl}/api/epl/atlas-brief?format=markdown&role=${encodeURIComponent(role)}`)
  const lib = url.protocol === 'https:' ? require('node:https') : require('node:http')
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      headers: { 'x-api-key': apiKey, 'accept': 'text/plain' },
      method: 'GET',
    }, (res) => {
      let body = ''
      res.on('data', (chunk) => body += chunk)
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`brief HTTP ${res.statusCode}: ${body.slice(0, 200)}`))
        resolve(body)
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(new Error('brief fetch timeout')) })
    req.end()
  })
}

function postSlackWebhook(webhookUrl, markdown) {
  const url = new URL(webhookUrl)
  const payload = JSON.stringify({ text: markdown, mrkdwn: true })
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = ''
      res.on('data', (chunk) => body += chunk)
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`slack HTTP ${res.statusCode}: ${body.slice(0, 200)}`))
        resolve(body)
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(new Error('slack post timeout')) })
    req.write(payload)
    req.end()
  })
}

function postSlackBotApi(token, channelId, markdown) {
  const payload = JSON.stringify({ channel: channelId, text: markdown, mrkdwn: true })
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: 'slack.com', port: 443, path: '/api/chat.postMessage', method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'authorization': `Bearer ${token}`,
        'content-length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = ''
      res.on('data', (chunk) => body += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          if (!parsed.ok) return reject(new Error(`slack api: ${parsed.error}`))
          resolve(parsed)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(new Error('slack post timeout')) })
    req.write(payload)
    req.end()
  })
}

async function main() {
  const webhook = process.env.SLACK_WEBHOOK_URL
  const botToken = process.env.SLACK_BOT_TOKEN
  const channelId = process.env.SLACK_CHANNEL_ID
  const dryRun = process.env.BRIEF_DRY_RUN === '1' || (!webhook && !(botToken && channelId))

  let markdown
  try {
    markdown = await fetchBrief()
  } catch (e) {
    console.error(`brief fetch failed: ${e.message}`)
    process.exit(1)
  }

  if (dryRun) {
    // No Slack target (or BRIEF_DRY_RUN=1) — print to stdout so cron logs it.
    // Useful before SLACK_WEBHOOK_URL is wired: cron still runs daily, output
    // collects in /var/log/atlas-brief.log so you can see the brief firing.
    console.log(`[${new Date().toISOString()}] atlas-brief (dry-run, ${markdown.length} chars):`)
    console.log(markdown)
    console.log('---')
    process.exit(0)
  }

  try {
    if (webhook) {
      await postSlackWebhook(webhook, markdown)
    } else {
      await postSlackBotApi(botToken, channelId, markdown)
    }
    console.log(`[${new Date().toISOString()}] atlas-brief posted (${markdown.length} chars)`)
    process.exit(0)
  } catch (e) {
    console.error(`slack post failed: ${e.message}`)
    process.exit(2)
  }
}

main()
