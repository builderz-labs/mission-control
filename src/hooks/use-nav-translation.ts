'use client'

import { useTranslations } from 'next-intl'

// Navigation item translations
const navTranslations: Record<string, Record<string, string>> = {
  en: {
    overview: 'Overview',
    agents: 'Agents',
    tasks: 'Tasks',
    chat: 'Chat',
    channels: 'Channels',
    skills: 'Skills',
    memory: 'Memory',
    activity: 'Activity',
    logs: 'Logs',
    'cost-tracker': 'Cost Tracker',
    nodes: 'Nodes',
    'exec-approvals': 'Approvals',
    office: 'Office',
    cron: 'Cron',
    webhooks: 'Webhooks',
    alerts: 'Alerts',
    github: 'GitHub',
    security: 'Security',
    users: 'Users',
    audit: 'Audit',
    gateways: 'Gateways',
    'gateway-config': 'Config',
    integrations: 'Integrations',
    debug: 'Debug',
    settings: 'Settings',
  },
  zh: {
    overview: '概览',
    agents: '智能体',
    tasks: '任务',
    chat: '聊天',
    channels: '渠道',
    skills: '技能',
    memory: '记忆',
    activity: '活动',
    logs: '日志',
    'cost-tracker': '成本追踪',
    nodes: '节点',
    'exec-approvals': '审批',
    office: '办公室',
    cron: '定时任务',
    webhooks: 'Webhooks',
    alerts: '告警',
    github: 'GitHub',
    security: '安全',
    users: '用户',
    audit: '审计',
    gateways: '网关',
    'gateway-config': '配置',
    integrations: '集成',
    debug: '调试',
    settings: '设置',
  }
}

// Group header translations
const groupTranslations: Record<string, Record<string, string>> = {
  en: {
    core: '',
    observe: 'OBSERVE',
    automate: 'AUTOMATE',
    admin: 'ADMIN',
  },
  zh: {
    core: '',
    observe: '观察',
    automate: '自动化',
    admin: '管理',
  }
}

// Common UI text translations
const uiTranslations: Record<string, Record<string, string>> = {
  en: {
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',
    more: 'More',
    interface: 'Interface',
    essential: 'Essential',
    full: 'Full',
    connected: 'Connected',
    disconnected: 'Disconnected',
    localMode: 'Local Mode',
    newProject: 'New project...',
    newOrganization: 'New organization...',
    organizations: 'ORGANIZATIONS',
    settings: 'Settings',
    activity: 'Activity',
    all: 'All',
  },
  zh: {
    collapseSidebar: '收起侧边栏',
    expandSidebar: '展开侧边栏',
    more: '更多',
    interface: '界面',
    essential: '精简',
    full: '完整',
    connected: '已连接',
    disconnected: '已断开',
    localMode: '本地模式',
    newProject: '新建项目...',
    newOrganization: '新建组织...',
    organizations: '组织',
    settings: '设置',
    activity: '活动',
    all: '全部',
  }
}

export function useNavTranslation() {
  const t = useTranslations('nav')
  const locale = typeof window !== 'undefined' 
    ? (document.cookie.match(/NEXT_LOCALE=(\w+)/)?.[1] || 'en')
    : 'en'

  return {
    t,
    locale,
    navItem: (id: string): string => {
      return navTranslations[locale]?.[id] || navTranslations.en[id] || id
    },
    groupLabel: (id: string): string => {
      return groupTranslations[locale]?.[id] || groupTranslations.en[id] || ''
    },
    uiText: (key: string): string => {
      return uiTranslations[locale]?.[key] || uiTranslations.en[key] || key
    },
  }
}