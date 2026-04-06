// Builds the ordered list of provisioning steps for bootstrap and decommission
// jobs. Pure functions — no DB or I/O side effects, easy to unit-test.

import path from 'path'
import { ProvisionStep } from './types'
import { getTenantHomeRoot, joinPosix } from './provision-utils'
import { config as appConfig } from '../config'

export interface BootstrapPlanTenant {
  slug: string
  linux_user: string
  openclaw_home: string
  workspace_root: string
  gateway_port?: number | null
  dashboard_port?: number | null
}

export interface BootstrapPlanOpts {
  templateOpenclawJsonPath: string
  gatewaySystemdTemplatePath: string
}

export function buildBootstrapPlan(
  tenant: BootstrapPlanTenant,
  opts: BootstrapPlanOpts,
): ProvisionStep[] {
  const artifactDir = path.join(appConfig.dataDir, 'provisioner', tenant.slug)
  const homeDir = joinPosix(getTenantHomeRoot(), tenant.linux_user)

  return [
    {
      key: 'create-linux-user',
      title: `Create linux user ${tenant.linux_user}`,
      command: ['/usr/sbin/useradd', '-m', '-s', '/bin/bash', tenant.linux_user],
      requires_root: true,
      timeout_ms: 10000,
    },
    {
      key: 'create-openclaw-state',
      title: `Create OpenClaw state directory ${tenant.openclaw_home}`,
      command: [
        '/usr/bin/install',
        '-d', '-m', '0750',
        '-o', tenant.linux_user,
        '-g', tenant.linux_user,
        tenant.openclaw_home,
      ],
      requires_root: true,
      timeout_ms: 10000,
    },
    {
      key: 'create-workspace-root',
      title: `Create workspace root ${tenant.workspace_root}`,
      command: [
        '/usr/bin/install',
        '-d', '-m', '0750',
        '-o', tenant.linux_user,
        '-g', tenant.linux_user,
        tenant.workspace_root,
      ],
      requires_root: true,
      timeout_ms: 10000,
    },
    {
      key: 'seed-openclaw-template',
      title: 'Seed base OpenClaw config scaffold',
      command: [
        '/usr/bin/cp',
        '-n',
        opts.templateOpenclawJsonPath,
        `${tenant.openclaw_home}/openclaw.json`,
      ],
      requires_root: true,
      timeout_ms: 12000,
    },
    {
      key: 'set-owner-home',
      title: `Ensure ownership of ${homeDir}`,
      command: [
        '/usr/bin/chown',
        '-R',
        `${tenant.linux_user}:${tenant.linux_user}`,
        homeDir,
      ],
      requires_root: true,
      timeout_ms: 20000,
    },
    {
      key: 'ensure-openclaw-tenants-dir',
      title: 'Ensure /etc/openclaw-tenants exists',
      command: [
        '/usr/bin/install',
        '-d', '-m', '0750',
        '-o', 'root',
        '-g', 'root',
        '/etc/openclaw-tenants',
      ],
      requires_root: true,
      timeout_ms: 5000,
    },
    {
      key: 'install-gateway-systemd-template',
      title: 'Install openclaw-gateway@.service template',
      command: [
        '/usr/bin/cp',
        '-n',
        opts.gatewaySystemdTemplatePath,
        '/etc/systemd/system/openclaw-gateway@.service',
      ],
      requires_root: true,
      timeout_ms: 5000,
    },
    {
      key: 'install-tenant-gateway-env',
      title: 'Install tenant gateway env file',
      command: [
        '/usr/bin/cp',
        '-f',
        `${artifactDir}/openclaw-gateway.env`,
        `/etc/openclaw-tenants/${tenant.linux_user}.env`,
      ],
      requires_root: true,
      timeout_ms: 5000,
    },
    {
      key: 'systemd-daemon-reload',
      title: 'Reload systemd units',
      command: ['/usr/bin/systemctl', 'daemon-reload'],
      requires_root: true,
      timeout_ms: 10000,
    },
    {
      key: 'enable-start-gateway',
      title: `Enable/start openclaw-gateway@${tenant.linux_user}.service`,
      command: [
        '/usr/bin/systemctl',
        'enable',
        '--now',
        `openclaw-gateway@${tenant.linux_user}.service`,
      ],
      requires_root: true,
      timeout_ms: 5000,
    },
  ]
}

export interface DecommissionPlanTenant {
  slug: string
  linux_user: string
  openclaw_home: string
  workspace_root: string
}

export interface DecommissionPlanOptions {
  remove_linux_user?: boolean
  remove_state_dirs?: boolean
}

export function buildDecommissionPlan(
  tenant: DecommissionPlanTenant,
  options?: DecommissionPlanOptions,
): ProvisionStep[] {
  const removeLinuxUser = !!options?.remove_linux_user
  const removeStateDirs = !!options?.remove_state_dirs

  const plan: ProvisionStep[] = [
    {
      key: 'disable-stop-gateway',
      title: `Disable/stop openclaw-gateway@${tenant.linux_user}.service`,
      command: [
        '/usr/bin/systemctl',
        'disable',
        '--now',
        `openclaw-gateway@${tenant.linux_user}.service`,
      ],
      requires_root: true,
      timeout_ms: 10000,
    },
    {
      key: 'remove-tenant-gateway-env',
      title: `Remove /etc/openclaw-tenants/${tenant.linux_user}.env`,
      command: [
        '/usr/bin/rm',
        '-f',
        `/etc/openclaw-tenants/${tenant.linux_user}.env`,
      ],
      requires_root: true,
      timeout_ms: 5000,
    },
  ]

  if (removeStateDirs && !removeLinuxUser) {
    return [
      ...plan,
      {
        key: 'remove-openclaw-state-dir',
        title: `Remove ${tenant.openclaw_home}`,
        command: ['/usr/bin/rm', '-rf', tenant.openclaw_home],
        requires_root: true,
        timeout_ms: 10000,
      },
      {
        key: 'remove-workspace-dir',
        title: `Remove ${tenant.workspace_root}`,
        command: ['/usr/bin/rm', '-rf', tenant.workspace_root],
        requires_root: true,
        timeout_ms: 10000,
      },
      ...(removeLinuxUser
        ? [{
            key: 'remove-linux-user',
            title: `Remove linux user ${tenant.linux_user}`,
            command: ['/usr/sbin/userdel', '-r', tenant.linux_user],
            requires_root: true,
            timeout_ms: 15000,
          } satisfies ProvisionStep]
        : []),
    ]
  }

  if (removeLinuxUser) {
    return [
      ...plan,
      {
        key: 'remove-linux-user',
        title: `Remove linux user ${tenant.linux_user}`,
        command: ['/usr/sbin/userdel', '-r', tenant.linux_user],
        requires_root: true,
        timeout_ms: 15000,
      },
    ]
  }

  return plan
}
