export interface StripeRevenueAccountConfig {
  id: string
  name: string
  secretKeyEnv?: string
  secretKey?: string
  currency?: string
}

export interface MoneyAmount {
  cents: number
  amount: number
  currency: string
}

export interface RevenuePeriod {
  gross: MoneyAmount
  net: MoneyAmount
  transactionCount: number
}

export interface StripeRevenueAccountSummary {
  id: string
  name: string
  currency: string
  today: RevenuePeriod
  yesterday: RevenuePeriod
  monthToDate: RevenuePeriod
  yearToDate: RevenuePeriod
  mrr: MoneyAmount
  arr: MoneyAmount
  subscriptionCount: number
  status: 'ok' | 'error'
  error?: string
}

export interface StripeRevenueSnapshot {
  generatedAt: string
  configured: boolean
  accounts: StripeRevenueAccountSummary[]
  totals: Omit<StripeRevenueAccountSummary, 'id' | 'name' | 'status' | 'error'>
  setupHint?: string
}

type RevenueEnv = Record<string, string | undefined>

interface StripeListResponse<T> {
  data: T[]
  has_more: boolean
}

interface StripeBalanceTransaction {
  id: string
  amount: number
  fee: number
  net: number
  currency: string
  type?: string
  reporting_category?: string
}

interface StripeSubscription {
  id: string
  status: string
  items?: {
    data?: StripeSubscriptionItem[]
  }
}

interface StripeSubscriptionItem {
  quantity?: number
  price?: StripePrice | null
}

interface StripePrice {
  currency?: string
  unit_amount?: number | null
  unit_amount_decimal?: string | null
  recurring?: {
    interval?: 'day' | 'week' | 'month' | 'year'
    interval_count?: number
  } | null
}

const STRIPE_API_BASE = 'https://api.stripe.com/v1'
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due'])
const GROSS_TYPES = new Set(['charge', 'payment'])
const NET_TYPES = new Set([
  'charge',
  'payment',
  'refund',
  'payment_refund',
  'payment_reversal',
  'dispute',
  'issuing_dispute',
  'dispute_reversal',
  'refund_failure',
  'payment_failure_refund',
])

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stripe'
}

function titleFromEnvToken(token: string): string {
  return token
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Stripe'
}

function parseAccountConfig(raw: string): StripeRevenueAccountConfig[] {
  if (!raw.trim()) return []
  const parsed = JSON.parse(raw)
  const accounts = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.accounts) ? parsed.accounts : []
  return accounts
    .map((item: any): StripeRevenueAccountConfig | null => {
      const secretKeyEnv = typeof item?.secretKeyEnv === 'string'
        ? item.secretKeyEnv
        : typeof item?.secret_key_env === 'string'
          ? item.secret_key_env
          : undefined
      const secretKey = typeof item?.secretKey === 'string'
        ? item.secretKey
        : typeof item?.secret_key === 'string'
          ? item.secret_key
          : undefined
      const name = String(item?.name || item?.label || item?.id || secretKeyEnv || 'Stripe').trim()
      const id = String(item?.id || slugify(name)).trim()
      if (!id || (!secretKeyEnv && !secretKey)) return null
      return {
        id,
        name,
        secretKeyEnv,
        secretKey,
        currency: typeof item?.currency === 'string' ? item.currency.toLowerCase() : undefined,
      }
    })
    .filter((account: StripeRevenueAccountConfig | null): account is StripeRevenueAccountConfig => account !== null)
}

export function getStripeRevenueAccountConfigs(env: RevenueEnv = process.env): StripeRevenueAccountConfig[] {
  const configured = env.STRIPE_REVENUE_ACCOUNTS || env.STRIPE_ACCOUNTS || ''
  if (configured.trim()) {
    try {
      return parseAccountConfig(configured)
    } catch {
      return []
    }
  }

  const discovered = Object.keys(env)
    .filter(key => /^STRIPE_[A-Z0-9_]+_SECRET_KEY$/.test(key))
    .filter(key => key !== 'STRIPE_SECRET_KEY')
    .sort()
    .map((key): StripeRevenueAccountConfig => {
      const token = key.replace(/^STRIPE_/, '').replace(/_SECRET_KEY$/, '')
      return {
        id: slugify(token),
        name: env[`STRIPE_${token}_NAME`] || titleFromEnvToken(token),
        secretKeyEnv: key,
        currency: env[`STRIPE_${token}_CURRENCY`]?.toLowerCase(),
      }
    })

  if (discovered.length > 0) return discovered

  if (env.STRIPE_SECRET_KEY) {
    return [{
      id: 'default',
      name: env.STRIPE_ACCOUNT_NAME || 'Stripe',
      secretKeyEnv: 'STRIPE_SECRET_KEY',
      currency: env.STRIPE_CURRENCY?.toLowerCase(),
    }]
  }

  return []
}

function secretForAccount(account: StripeRevenueAccountConfig, env: RevenueEnv): string {
  const secret = account.secretKey || (account.secretKeyEnv ? env[account.secretKeyEnv] : '')
  return (secret || '').trim()
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export function getLocalRevenueRanges(now = new Date()) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const yearStart = new Date(now.getFullYear(), 0, 1)

  return {
    today: { gte: unixSeconds(todayStart), lt: unixSeconds(tomorrowStart) },
    yesterday: { gte: unixSeconds(yesterdayStart), lt: unixSeconds(todayStart) },
    monthToDate: { gte: unixSeconds(monthStart), lt: unixSeconds(tomorrowStart) },
    yearToDate: { gte: unixSeconds(yearStart), lt: unixSeconds(tomorrowStart) },
  }
}

function money(cents: number, currency: string): MoneyAmount {
  return {
    cents,
    amount: Number((cents / 100).toFixed(2)),
    currency,
  }
}

function revenueType(txn: StripeBalanceTransaction): string {
  return String(txn.reporting_category || txn.type || '').toLowerCase()
}

function summarizeBalanceTransactions(transactions: StripeBalanceTransaction[], fallbackCurrency: string): RevenuePeriod {
  const currency = transactions.find(txn => txn.currency)?.currency || fallbackCurrency
  let gross = 0
  let net = 0
  let count = 0

  for (const txn of transactions) {
    const type = revenueType(txn)
    if (GROSS_TYPES.has(type) && txn.amount > 0) gross += txn.amount
    if (NET_TYPES.has(type)) {
      net += txn.net
      count += 1
    }
  }

  return {
    gross: money(gross, currency),
    net: money(net, currency),
    transactionCount: count,
  }
}

function amountFromPrice(price: StripePrice): number {
  if (typeof price.unit_amount === 'number') return price.unit_amount
  if (price.unit_amount_decimal) return Math.round(Number(price.unit_amount_decimal))
  return 0
}

function monthlyCentsForPrice(price: StripePrice, quantity = 1): number {
  const recurring = price.recurring
  if (!recurring?.interval) return 0
  const intervalCount = Math.max(1, recurring.interval_count || 1)
  const cents = amountFromPrice(price) * Math.max(1, quantity || 1)
  switch (recurring.interval) {
    case 'day':
      return Math.round(cents * 365 / 12 / intervalCount)
    case 'week':
      return Math.round(cents * 52 / 12 / intervalCount)
    case 'year':
      return Math.round(cents / 12 / intervalCount)
    case 'month':
    default:
      return Math.round(cents / intervalCount)
  }
}

export function summarizeSubscriptions(subscriptions: StripeSubscription[], fallbackCurrency: string) {
  const active = subscriptions.filter(sub => ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status))
  const currency = active
    .flatMap(sub => sub.items?.data || [])
    .find(item => item.price?.currency)?.price?.currency || fallbackCurrency

  let mrrCents = 0
  for (const subscription of active) {
    for (const item of subscription.items?.data || []) {
      if (!item.price) continue
      mrrCents += monthlyCentsForPrice(item.price, item.quantity || 1)
    }
  }

  return {
    mrr: money(mrrCents, currency),
    arr: money(mrrCents * 12, currency),
    subscriptionCount: active.length,
  }
}

async function fetchStripeList<T>(
  secretKey: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  maxPages = 20,
): Promise<T[]> {
  const all: T[] = []
  let startingAfter: string | undefined

  for (let page = 0; page < maxPages; page += 1) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.append(key, String(value))
    }
    if (startingAfter) search.set('starting_after', startingAfter)

    const response = await fetch(`${STRIPE_API_BASE}${path}?${search.toString()}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
        Accept: 'application/json',
      },
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = typeof payload?.error?.message === 'string'
        ? payload.error.message
        : `Stripe request failed with ${response.status}`
      throw new Error(message)
    }

    const list = payload as StripeListResponse<T>
    all.push(...(Array.isArray(list.data) ? list.data : []))
    if (!list.has_more || list.data.length === 0) break

    const last = list.data[list.data.length - 1] as any
    startingAfter = typeof last?.id === 'string' ? last.id : undefined
    if (!startingAfter) break
  }

  return all
}

async function fetchPeriod(secretKey: string, range: { gte: number; lt: number }): Promise<StripeBalanceTransaction[]> {
  return fetchStripeList<StripeBalanceTransaction>(secretKey, '/balance_transactions', {
    limit: 100,
    'created[gte]': range.gte,
    'created[lt]': range.lt,
  })
}

async function summarizeAccount(
  account: StripeRevenueAccountConfig,
  env: RevenueEnv,
  ranges = getLocalRevenueRanges(),
): Promise<StripeRevenueAccountSummary> {
  const secretKey = secretForAccount(account, env)
  const fallbackCurrency = account.currency || 'usd'
  const blankPeriod = summarizeBalanceTransactions([], fallbackCurrency)

  if (!secretKey) {
    return {
      id: account.id,
      name: account.name,
      currency: fallbackCurrency,
      today: blankPeriod,
      yesterday: blankPeriod,
      monthToDate: blankPeriod,
      yearToDate: blankPeriod,
      mrr: money(0, fallbackCurrency),
      arr: money(0, fallbackCurrency),
      subscriptionCount: 0,
      status: 'error',
      error: account.secretKeyEnv ? `${account.secretKeyEnv} is not set` : 'Stripe secret key is not set',
    }
  }

  try {
    const [todayTxns, yesterdayTxns, mtdTxns, ytdTxns, subscriptions] = await Promise.all([
      fetchPeriod(secretKey, ranges.today),
      fetchPeriod(secretKey, ranges.yesterday),
      fetchPeriod(secretKey, ranges.monthToDate),
      fetchPeriod(secretKey, ranges.yearToDate),
      fetchStripeList<StripeSubscription>(secretKey, '/subscriptions', {
        limit: 100,
        status: 'all',
        'expand[]': 'data.items.data.price',
      }),
    ])

    const today = summarizeBalanceTransactions(todayTxns, fallbackCurrency)
    const yesterday = summarizeBalanceTransactions(yesterdayTxns, today.gross.currency || fallbackCurrency)
    const monthToDate = summarizeBalanceTransactions(mtdTxns, today.gross.currency || fallbackCurrency)
    const yearToDate = summarizeBalanceTransactions(ytdTxns, today.gross.currency || fallbackCurrency)
    const recurring = summarizeSubscriptions(subscriptions, today.gross.currency || fallbackCurrency)

    return {
      id: account.id,
      name: account.name,
      currency: today.gross.currency || fallbackCurrency,
      today,
      yesterday,
      monthToDate,
      yearToDate,
      ...recurring,
      status: 'ok',
    }
  } catch (err) {
    return {
      id: account.id,
      name: account.name,
      currency: fallbackCurrency,
      today: blankPeriod,
      yesterday: blankPeriod,
      monthToDate: blankPeriod,
      yearToDate: blankPeriod,
      mrr: money(0, fallbackCurrency),
      arr: money(0, fallbackCurrency),
      subscriptionCount: 0,
      status: 'error',
      error: err instanceof Error ? err.message : 'Stripe request failed',
    }
  }
}

function aggregatePeriod(accounts: StripeRevenueAccountSummary[], key: 'today' | 'yesterday' | 'monthToDate' | 'yearToDate', currency: string): RevenuePeriod {
  return {
    gross: money(accounts.reduce((sum, account) => sum + (account[key].gross.currency === currency ? account[key].gross.cents : 0), 0), currency),
    net: money(accounts.reduce((sum, account) => sum + (account[key].net.currency === currency ? account[key].net.cents : 0), 0), currency),
    transactionCount: accounts.reduce((sum, account) => sum + account[key].transactionCount, 0),
  }
}

function aggregateTotals(accounts: StripeRevenueAccountSummary[]): StripeRevenueSnapshot['totals'] {
  const currency = accounts.find(account => account.status === 'ok')?.currency || accounts[0]?.currency || 'usd'
  const mrrCents = accounts.reduce((sum, account) => sum + (account.mrr.currency === currency ? account.mrr.cents : 0), 0)
  return {
    currency,
    today: aggregatePeriod(accounts, 'today', currency),
    yesterday: aggregatePeriod(accounts, 'yesterday', currency),
    monthToDate: aggregatePeriod(accounts, 'monthToDate', currency),
    yearToDate: aggregatePeriod(accounts, 'yearToDate', currency),
    mrr: money(mrrCents, currency),
    arr: money(mrrCents * 12, currency),
    subscriptionCount: accounts.reduce((sum, account) => sum + account.subscriptionCount, 0),
  }
}

export async function getStripeRevenueSnapshot(env: RevenueEnv = process.env): Promise<StripeRevenueSnapshot> {
  const configs = getStripeRevenueAccountConfigs(env)
  if (configs.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      configured: false,
      accounts: [],
      totals: aggregateTotals([]),
      setupHint: 'Set STRIPE_REVENUE_ACCOUNTS to a JSON array of account configs, or provide STRIPE_<ACCOUNT>_SECRET_KEY env vars.',
    }
  }

  const accounts = await Promise.all(configs.map(config => summarizeAccount(config, env)))
  return {
    generatedAt: new Date().toISOString(),
    configured: true,
    accounts,
    totals: aggregateTotals(accounts),
  }
}
