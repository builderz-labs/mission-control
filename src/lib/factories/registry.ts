import type { FactoryAdapter } from './adapters/factory-adapter'
import { productFactoryAdapter } from './adapters/product-factory-adapter'
import { shufuroMarketingAdapter } from './adapters/shufuro-marketing-adapter'
import { shufuroCreativeAdapter } from './adapters/shufuro-creative-adapter'

const adapters = new Map<string, FactoryAdapter>([
  [productFactoryAdapter.id, productFactoryAdapter],
  [shufuroMarketingAdapter.id, shufuroMarketingAdapter],
  [shufuroCreativeAdapter.id, shufuroCreativeAdapter],
])

export function listFactoryAdapters(): FactoryAdapter[] {
  return Array.from(adapters.values())
}

export function getFactoryAdapter(adapterId: string): FactoryAdapter | null {
  return adapters.get(adapterId) || null
}

export function getFactoryAdapterForModule(moduleId: string): FactoryAdapter | null {
  return listFactoryAdapters().find((adapter) => adapter.moduleId === moduleId) || null
}
