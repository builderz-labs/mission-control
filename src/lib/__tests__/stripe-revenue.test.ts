import { describe, expect, it } from 'vitest'
import {
  getLocalRevenueRanges,
  getStripeRevenueAccountConfigs,
  getStripeRevenueSnapshot,
  summarizeSubscriptions,
} from '../stripe-revenue'

describe('stripe revenue config', () => {
  it('loads account configs from STRIPE_REVENUE_ACCOUNTS JSON', () => {
    const accounts = getStripeRevenueAccountConfigs({
      STRIPE_REVENUE_ACCOUNTS: JSON.stringify([
        { id: 'lotw', name: 'Liz on the Web', secretKeyEnv: 'STRIPE_LOTW_SECRET_KEY', currency: 'usd' },
        { id: 'second', label: 'Second Biz', secret_key_env: 'STRIPE_SECOND_SECRET_KEY' },
      ]),
    })

    expect(accounts).toEqual([
      { id: 'lotw', name: 'Liz on the Web', secretKeyEnv: 'STRIPE_LOTW_SECRET_KEY', secretKey: undefined, currency: 'usd' },
      { id: 'second', name: 'Second Biz', secretKeyEnv: 'STRIPE_SECOND_SECRET_KEY', secretKey: undefined, currency: undefined },
    ])
  })

  it('discovers prefixed Stripe secret key env vars', () => {
    const accounts = getStripeRevenueAccountConfigs({
      STRIPE_LOTW_SECRET_KEY: 'sk_test_lotw',
      STRIPE_LOTW_NAME: 'LOTW',
      STRIPE_SECOND_BIZ_SECRET_KEY: 'sk_test_second',
    })

    expect(accounts).toEqual([
      { id: 'lotw', name: 'LOTW', secretKeyEnv: 'STRIPE_LOTW_SECRET_KEY', currency: undefined },
      { id: 'second-biz', name: 'Second Biz', secretKeyEnv: 'STRIPE_SECOND_BIZ_SECRET_KEY', currency: undefined },
    ])
  })

  it('returns an unconfigured snapshot without calling Stripe', async () => {
    const snapshot = await getStripeRevenueSnapshot({})

    expect(snapshot.configured).toBe(false)
    expect(snapshot.accounts).toEqual([])
    expect(snapshot.totals.today.gross.amount).toBe(0)
    expect(snapshot.setupHint).toContain('STRIPE_REVENUE_ACCOUNTS')
  })
})

describe('stripe revenue math', () => {
  it('normalizes subscription prices into MRR and ARR', () => {
    const summary = summarizeSubscriptions([
      {
        id: 'sub_monthly',
        status: 'active',
        items: {
          data: [
            {
              quantity: 2,
              price: {
                currency: 'usd',
                unit_amount: 10000,
                recurring: { interval: 'month', interval_count: 1 },
              },
            },
          ],
        },
      },
      {
        id: 'sub_yearly',
        status: 'trialing',
        items: {
          data: [
            {
              quantity: 1,
              price: {
                currency: 'usd',
                unit_amount: 120000,
                recurring: { interval: 'year', interval_count: 1 },
              },
            },
          ],
        },
      },
      {
        id: 'sub_canceled',
        status: 'canceled',
        items: {
          data: [
            {
              quantity: 1,
              price: {
                currency: 'usd',
                unit_amount: 999900,
                recurring: { interval: 'month', interval_count: 1 },
              },
            },
          ],
        },
      },
    ], 'usd')

    expect(summary.subscriptionCount).toBe(2)
    expect(summary.mrr.amount).toBe(300)
    expect(summary.arr.amount).toBe(3600)
  })

  it('builds local day, month, and year date ranges', () => {
    const ranges = getLocalRevenueRanges(new Date(2026, 5, 4, 10, 30, 0))

    expect(ranges.today.gte).toBeLessThan(ranges.today.lt)
    expect(ranges.yesterday.lt).toBe(ranges.today.gte)
    expect(ranges.monthToDate.gte).toBeLessThan(ranges.today.gte)
    expect(ranges.yearToDate.gte).toBeLessThan(ranges.monthToDate.gte)
  })
})
