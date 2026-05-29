import { describe, expect, it } from 'vitest'
import {
  renderTaskDefinition,
  renderTargetGroup,
  renderService,
  renderListenerRule,
  type OpenClawAgentInput,
  type OpenClawAgentEnv,
} from '../templates/openclaw'
import { HARNESS_TEMPLATES } from '../templates'
import {
  AGENT_NAME_MIN_LENGTH,
  AGENT_NAME_RE,
} from '../templates/constraints'

const fixtureInput: OpenClawAgentInput = {
  agentName: 'hello-bot',
  roleDescription: 'Says hello',
  image: 'ghcr.io/stroupaloop/openclaw:sha-abc123',
}

const fixtureEnv: OpenClawAgentEnv = {
  region: 'us-east-1',
  prefix: 'ender-stack-dev',
  clusterName: 'ender-stack-dev',
  taskRoleArn:
    'arn:aws:iam::398152419239:role/ender-stack-dev-companion-openclaw-mc-task',
  executionRoleArn:
    'arn:aws:iam::398152419239:role/ender-stack-dev-companion-openclaw-mc-exec',
  logGroupPrefix: '/ecs/ender-stack-dev',
  vpcId: 'vpc-abc',
  subnetIds: ['subnet-1', 'subnet-2'],
  securityGroupId: 'sg-ecs',
  litellmAlbDnsName: 'internal-litellm.us-east-1.elb.amazonaws.com',
  tags: {
    Project: 'ender-stack',
    Environment: 'dev',
    Owner: 'mission-control',
    ManagedBy: 'mission-control',
  },
}

describe('renderTaskDefinition', () => {
  // Helper: containers are at fixed indices today (init-config at 0,
  // gateway at 1) but querying by name is more robust to ordering
  // changes. Both are exercised below.
  const findContainer = (
    taskDef: ReturnType<typeof renderTaskDefinition>,
    name: string,
  ) => taskDef.containerDefinitions?.find((c) => c.name === name)

  it('builds the family from prefix + agent name', () => {
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    expect(taskDef.family).toBe('ender-stack-dev-companion-openclaw-hello-bot')
  })

  it('sets Fargate-compatible launch type and awsvpc network', () => {
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    expect(taskDef.requiresCompatibilities).toEqual(['FARGATE'])
    expect(taskDef.networkMode).toBe('awsvpc')
  })

  it('emits init-config sidecar + gateway in that order with dependsOn', () => {
    // #215: two-container shape (init-config at 0, gateway at 1).
    // Order is load-bearing for clarity in the AWS console; dependsOn
    // is the actual gating mechanism. Both asserted.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    expect(taskDef.containerDefinitions).toHaveLength(2)
    expect(taskDef.containerDefinitions?.[0]?.name).toBe('init-config')
    expect(taskDef.containerDefinitions?.[1]?.name).toBe('gateway')

    const gateway = findContainer(taskDef, 'gateway')
    expect(gateway?.dependsOn).toEqual([
      { containerName: 'init-config', condition: 'SUCCESS' },
    ])
  })

  it('init-config runs as root with an inline shell that mkdirs + chowns ephemeral volumes', () => {
    // Fargate ephemeral volumes mount root-owned (no equivalent of
    // EFS access points' posixUser). The bundled init-config.sh
    // assumes uid 1000 ownership (smoke-test path); on ephemeral
    // its mkdir would Permission Denied. So MC runs init-config as
    // root with an inline command that mkdirs the state subdirs +
    // chowns workspace/plugin-deps to uid 1000 so the gateway
    // (running as the image's default node user) can write.
    //
    // essential=false means task lifetime tracks gateway, not init-
    // config (init exits 0 on success, which would otherwise tear
    // down the whole task on essential=true).
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const init = findContainer(taskDef, 'init-config')
    expect(init?.essential).toBe(false)
    expect(init?.user).toBe('0')
    expect(init?.entryPoint).toEqual(['/bin/sh', '-c'])
    expect(init?.command).toHaveLength(1)
    const script = init?.command?.[0] ?? ''
    // Spot-check the load-bearing operations are present.
    expect(script).toContain('mkdir -p')
    // Chown asserted as the FULL substring including the workspace
    // target path. Two independent `toContain`s (one on the chown
    // command, one on the path) would pass for a script that used
    // the right command at a wrong path and the right path elsewhere
    // — substring-matching the assembled form catches mis-assembly.
    // `id -u node` instead of hardcoded 1000 so the test stays
    // correct under any future upstream UID change.
    expect(script).toContain(
      // Beat 5e: chown the CONFIG mount root (not just workspace) so
      // init-config.sh — which runs as node via `su -m` — can write
      // openclaw.json. -R doesn't stop at mount boundaries, so this
      // single chown covers config + workspace + plugin-deps.
      'chown -R "$(id -u node):$(id -g node)" /home/node/.openclaw',
    )
    expect(script).toContain(
      '/home/node/.openclaw/workspace/.openclaw/agents',
    )
    expect(script).toContain(
      '/home/node/.openclaw/workspace/.openclaw/canvas',
    )
    expect(script).toContain('rm -f /home/node/.openclaw/openclaw.json')
    // Beat 5e: the inline shell drops to `node` and runs the
    // bundled init-config.sh — this is the load-bearing step
    // that templates openclaw.json with Slack channels + LiteLLM
    // provider config. -m preserves env vars (OPENCLAW_SLACK_CONFIG_JSON,
    // LITELLM_BASE_URL, LITELLM_VIRTUAL_KEY) through the user
    // switch; without it, the rendered config would be empty
    // and the gateway would silently boot --allow-unconfigured.
    expect(script).toContain(
      'su -m node -c /usr/local/bin/init-config.sh',
    )
  })

  it('passes the common env vars (AGENT_NAME, OPENCLAW_AGENT_NAME, OPENCLAW_STATE_DIR) on both containers', () => {
    // commonEnv: vars both containers actually consume. init-config
    // uses OPENCLAW_STATE_DIR + AGENT_NAME for state-dir mkdir;
    // gateway uses them at runtime.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    for (const containerName of ['init-config', 'gateway']) {
      const c = findContainer(taskDef, containerName)
      const env = c?.environment ?? []
      expect(env).toContainEqual({
        name: 'OPENCLAW_AGENT_NAME',
        value: 'hello-bot',
      })
      expect(env).toContainEqual({ name: 'AGENT_NAME', value: 'hello-bot' })
      expect(env).toContainEqual({
        name: 'OPENCLAW_STATE_DIR',
        value: '/home/node/.openclaw/workspace/.openclaw',
      })
      // OPENCLAW_MODEL was dropped in Beat 3b.1 — asserting absence
      // catches accidental re-introduction.
      expect(env.find((e) => e?.name === 'OPENCLAW_MODEL')).toBeUndefined()
    }
  })

  it('#357 Phase-2: AGENT_ROLE is on BOTH containers (renamed + relocated from gateway-only OPENCLAW_ROLE_DESCRIPTION)', () => {
    // Pre-Phase-2 the env var was named OPENCLAW_ROLE_DESCRIPTION and
    // lived on gatewayOnlyEnv. init-config never received it in
    // production. Phase-2 (ender-stack#361) renames to AGENT_ROLE and
    // moves it to commonEnv so init-config can read it at boot to
    // hard-template IDENTITY.md's Role: bullet. The gateway continues
    // to read it as part of the runtime role prompt.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const init = findContainer(taskDef, 'init-config')
    const gateway = findContainer(taskDef, 'gateway')
    const initEnv = init?.environment ?? []
    const gatewayEnv = gateway?.environment ?? []

    for (const env of [initEnv, gatewayEnv]) {
      expect(env).toContainEqual({ name: 'AGENT_ROLE', value: 'Says hello' })
      // LITELLM_BASE_URL: present on both (Beat 5e).
      expect(env).toContainEqual({
        name: 'LITELLM_BASE_URL',
        value: 'http://internal-litellm.us-east-1.elb.amazonaws.com',
      })
      // LITELLM_API_BASE: legacy alias, must be gone.
      expect(env.find((e) => e?.name === 'LITELLM_API_BASE')).toBeUndefined()
    }

    // OPENCLAW_ROLE_DESCRIPTION: kept as a gateway-side backward-compat
    // alias so the gateway runtime (OpenClaw upstream reads this name)
    // sees the role description even before ender-stack#361 merges and
    // re-points init-config to read AGENT_ROLE instead. Bot R2 medium
    // on PR #69. Init container does NOT receive it — only AGENT_ROLE.
    expect(gatewayEnv).toContainEqual({
      name: 'OPENCLAW_ROLE_DESCRIPTION',
      value: 'Says hello',
    })
    expect(
      initEnv.find((e) => e?.name === 'OPENCLAW_ROLE_DESCRIPTION'),
    ).toBeUndefined()
  })

  it('optional persona fields are emitted on both containers when provided (commonEnv)', () => {
    // When supplied, each becomes a commonEnv entry so init-config
    // (ender-stack#361) can hard-template IDENTITY.md placeholder
    // lines and a SOUL.md `Operator-Supplied Persona` section.
    const taskDef = renderTaskDefinition(
      {
        ...fixtureInput,
        displayName: 'Aria',
        persona: 'Direct, opinionated, resourceful. Skip filler.',
      },
      fixtureEnv,
    )
    const init = findContainer(taskDef, 'init-config')
    const gateway = findContainer(taskDef, 'gateway')

    for (const c of [init, gateway]) {
      const env = c?.environment ?? []
      expect(env).toContainEqual({ name: 'AGENT_DISPLAY_NAME', value: 'Aria' })
      expect(env).toContainEqual({
        name: 'AGENT_PERSONA',
        value: 'Direct, opinionated, resourceful. Skip filler.',
      })
    }
  })

  it('AGENT_EMOJI is never emitted (field removed)', () => {
    // The emoji field was removed from the create-agent form — the
    // env var should not appear on the task-def under any input
    // shape (defensive: ensure a legacy client passing a stray
    // property doesn't accidentally land on the task-def).
    const taskDef = renderTaskDefinition(
      // @ts-expect-error — emoji is no longer in OpenClawAgentInput
      { ...fixtureInput, emoji: '🦊' },
      fixtureEnv,
    )
    const init = findContainer(taskDef, 'init-config')
    const gateway = findContainer(taskDef, 'gateway')
    for (const c of [init, gateway]) {
      const env = c?.environment ?? []
      expect(env.find((e) => e?.name === 'AGENT_EMOJI')).toBeUndefined()
    }
  })

  it('persona fields are OMITTED from the task-def when unset (conditional emission)', () => {
    // Optional fields default to undefined / empty. The template only
    // emits the env-var entry when the value is truthy — keeps the
    // task-def env block clean for agents that opt out of persona
    // scaffolding. init-config falls back to canonical placeholders.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv) // no persona fields
    const init = findContainer(taskDef, 'init-config')
    const gateway = findContainer(taskDef, 'gateway')

    for (const c of [init, gateway]) {
      const env = c?.environment ?? []
      expect(
        env.find((e) => e?.name === 'AGENT_DISPLAY_NAME'),
      ).toBeUndefined()
      expect(env.find((e) => e?.name === 'AGENT_PERSONA')).toBeUndefined()
    }
  })

  it('persona fields explicitly set to empty string are also omitted (empty == absent)', () => {
    // Defensive: a client that sets displayName: '' (vs not supplying
    // the key at all) should produce the same task-def shape as the
    // "not supplied" case. Prevents subtle drift between the type
    // guard's accept-string and the template's emit-conditional logic.
    const taskDef = renderTaskDefinition(
      { ...fixtureInput, displayName: '', persona: '' },
      fixtureEnv,
    )
    const init = findContainer(taskDef, 'init-config')
    const initEnv = init?.environment ?? []
    expect(
      initEnv.find((e) => e?.name === 'AGENT_DISPLAY_NAME'),
    ).toBeUndefined()
    expect(initEnv.find((e) => e?.name === 'AGENT_PERSONA')).toBeUndefined()
  })

  it('persona fields with whitespace-only values are omitted (== absent)', () => {
    // Without the trim guard in the template, a `displayName: '   '`
    // is truthy → emits AGENT_DISPLAY_NAME='   ' → init-config sees a
    // non-empty value → substitutes blanks into IDENTITY.md and
    // suppresses the canonical placeholder. The operator gets
    // blank-looking identity content instead of the documented
    // fallback. Trim guard collapses whitespace-only to absent.
    const taskDef = renderTaskDefinition(
      {
        ...fixtureInput,
        displayName: '   ',
        persona: '\n   \n',
      },
      fixtureEnv,
    )
    const init = findContainer(taskDef, 'init-config')
    const initEnv = init?.environment ?? []
    expect(
      initEnv.find((e) => e?.name === 'AGENT_DISPLAY_NAME'),
    ).toBeUndefined()
    expect(initEnv.find((e) => e?.name === 'AGENT_PERSONA')).toBeUndefined()
  })

  it('#376: archetype + owner-layer env vars are emitted on both containers when provided (commonEnv)', () => {
    const taskDef = renderTaskDefinition(
      {
        ...fixtureInput,
        archetype: 'software-engineer',
        ownerName: 'Andrew Stroup',
        ownerSlackId: 'U01ABCDEF23',
        ownerTimezone: 'America/New_York',
      },
      fixtureEnv,
    )
    const init = findContainer(taskDef, 'init-config')
    const gateway = findContainer(taskDef, 'gateway')

    for (const c of [init, gateway]) {
      const env = c?.environment ?? []
      expect(env).toContainEqual({
        name: 'AGENT_ARCHETYPE',
        value: 'software-engineer',
      })
      expect(env).toContainEqual({
        name: 'AGENT_OWNER_NAME',
        value: 'Andrew Stroup',
      })
      expect(env).toContainEqual({
        name: 'AGENT_OWNER_SLACK_ID',
        value: 'U01ABCDEF23',
      })
      expect(env).toContainEqual({
        name: 'AGENT_OWNER_TZ',
        value: 'America/New_York',
      })
    }
  })

  it('#376: archetype + owner-layer env vars are OMITTED from the task-def when unset', () => {
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv) // no archetype/owner fields
    const init = findContainer(taskDef, 'init-config')
    const gateway = findContainer(taskDef, 'gateway')

    for (const c of [init, gateway]) {
      const env = c?.environment ?? []
      for (const name of [
        'AGENT_ARCHETYPE',
        'AGENT_OWNER_NAME',
        'AGENT_OWNER_SLACK_ID',
        'AGENT_OWNER_TZ',
      ]) {
        expect(env.find((e) => e?.name === name)).toBeUndefined()
      }
    }
  })

  it('#376: archetype + owner fields with empty strings are omitted (== absent)', () => {
    const taskDef = renderTaskDefinition(
      {
        ...fixtureInput,
        archetype: '',
        ownerName: '',
        ownerSlackId: '',
        ownerTimezone: '',
      },
      fixtureEnv,
    )
    const init = findContainer(taskDef, 'init-config')
    const initEnv = init?.environment ?? []
    for (const name of [
      'AGENT_ARCHETYPE',
      'AGENT_OWNER_NAME',
      'AGENT_OWNER_SLACK_ID',
      'AGENT_OWNER_TZ',
    ]) {
      expect(initEnv.find((e) => e?.name === name)).toBeUndefined()
    }
  })

  it('#376: archetype + owner fields with whitespace-only values are omitted (== absent)', () => {
    const taskDef = renderTaskDefinition(
      {
        ...fixtureInput,
        archetype: '  ',
        ownerName: '   ',
        ownerSlackId: ' U01ABCDEF23 ',
        ownerTimezone: '\n',
      },
      fixtureEnv,
    )
    const init = findContainer(taskDef, 'init-config')
    const initEnv = init?.environment ?? []
    // archetype + ownerName + ownerTimezone: whitespace-only → omitted.
    expect(
      initEnv.find((e) => e?.name === 'AGENT_ARCHETYPE'),
    ).toBeUndefined()
    expect(
      initEnv.find((e) => e?.name === 'AGENT_OWNER_NAME'),
    ).toBeUndefined()
    expect(
      initEnv.find((e) => e?.name === 'AGENT_OWNER_TZ'),
    ).toBeUndefined()
    // ownerSlackId: trim leaves the canonical U-prefix string, so the
    // template emits the trimmed value. init-config validates the
    // format defensively at the boot boundary.
    expect(initEnv).toContainEqual({
      name: 'AGENT_OWNER_SLACK_ID',
      value: 'U01ABCDEF23',
    })
  })

  it('#376: partial archetype + owner set is OK — fields are independently optional', () => {
    // Operator may supply only an archetype (e.g., for an unowned
    // platform agent) or only an owner without archetype (custom is
    // valid). Each field's emission is independent.
    const taskDef = renderTaskDefinition(
      { ...fixtureInput, archetype: 'sdr' },
      fixtureEnv,
    )
    const initEnv =
      findContainer(taskDef, 'init-config')?.environment ?? []
    expect(initEnv).toContainEqual({
      name: 'AGENT_ARCHETYPE',
      value: 'sdr',
    })
    // Owner fields are absent.
    for (const name of [
      'AGENT_OWNER_NAME',
      'AGENT_OWNER_SLACK_ID',
      'AGENT_OWNER_TZ',
    ]) {
      expect(initEnv.find((e) => e?.name === name)).toBeUndefined()
    }
  })

  it('#354: attaches LITELLM_VIRTUAL_KEY secret to both containers from the per-agent ARN', () => {
    const envWithSecret: OpenClawAgentEnv = {
      ...fixtureEnv,
      litellmAgentKeySecretArn:
        'arn:aws:secretsmanager:us-east-1:111:secret:test/companion-openclaw-fixture-agent-litellm-key-XyZ789',
    }
    const taskDef = renderTaskDefinition(fixtureInput, envWithSecret)
    const init = findContainer(taskDef, 'init-config')
    const gateway = findContainer(taskDef, 'gateway')

    expect(init?.secrets).toContainEqual({
      name: 'LITELLM_VIRTUAL_KEY',
      valueFrom: envWithSecret.litellmAgentKeySecretArn,
    })
    expect(gateway?.secrets).toContainEqual({
      name: 'LITELLM_VIRTUAL_KEY',
      valueFrom: envWithSecret.litellmAgentKeySecretArn,
    })
  })

  it('#354: skips LITELLM_VIRTUAL_KEY secret when per-agent ARN is absent', () => {
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const init = findContainer(taskDef, 'init-config')
    const gateway = findContainer(taskDef, 'gateway')
    expect(init?.secrets ?? []).toEqual([])
    expect(gateway?.secrets ?? []).toEqual([])
  })

  it('does not emit a SLACK_WEBHOOK_URL env var (deferred to Phase 2.4 — #247)', () => {
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    for (const containerName of ['init-config', 'gateway']) {
      const env = findContainer(taskDef, containerName)?.environment ?? []
      expect(env.find((e) => e.name === 'SLACK_WEBHOOK_URL')).toBeUndefined()
    }
  })

  it('declares three ephemeral Fargate volumes (config, workspace, plugin-deps)', () => {
    // No efsVolumeConfiguration on any volume ⇒ Fargate ephemeral
    // overlay. plugin-deps is its own volume (NOT nested under
    // workspace) so a future workspace-EFS migration doesn't drag
    // plugin staging onto EFS — see comment in the template.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    expect(taskDef.volumes).toHaveLength(3)
    const names = (taskDef.volumes ?? []).map((v) => v.name)
    expect(names).toEqual(['config', 'workspace', 'plugin-deps'])
    for (const v of taskDef.volumes ?? []) {
      expect(v.efsVolumeConfiguration).toBeUndefined()
      expect(v.host).toBeUndefined()
    }
  })

  it('mounts config RO + workspace RW + plugin-deps RW on the gateway', () => {
    // Read-only config matches the smoke-test contract: gateway
    // reads openclaw.json (or boots --allow-unconfigured); init-
    // config is the only writer. workspace + plugin-deps are RW
    // for OpenClaw's runtime state writes.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const gateway = findContainer(taskDef, 'gateway')
    const mounts = gateway?.mountPoints ?? []
    expect(mounts).toHaveLength(3)
    expect(mounts).toContainEqual({
      sourceVolume: 'config',
      containerPath: '/home/node/.openclaw',
      readOnly: true,
    })
    expect(mounts).toContainEqual({
      sourceVolume: 'workspace',
      containerPath: '/home/node/.openclaw/workspace',
      readOnly: false,
    })
    expect(mounts).toContainEqual({
      sourceVolume: 'plugin-deps',
      containerPath:
        '/home/node/.openclaw/workspace/.openclaw/plugin-runtime-deps',
      readOnly: false,
    })
  })

  it('mounts all three volumes RW on init-config (config + workspace + plugin-deps)', () => {
    // init-config needs write access to all three volume roots to
    // chown them to uid 1000. The previous shape (config + workspace
    // only) was incompatible with Fargate ephemeral storage —
    // plugin-deps would mount root-owned and the gateway running as
    // node couldn't write to it. The chown step requires the volume
    // to be visible inside this container.
    //
    // Diverges from the smoke-test pattern (which only mounts
    // config + workspace on its init-config because EFS access
    // points handle ownership at mount time). Documented in the
    // template comment above the init-config block.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const init = findContainer(taskDef, 'init-config')
    const mounts = init?.mountPoints ?? []
    expect(mounts).toHaveLength(3)
    expect(mounts).toContainEqual({
      sourceVolume: 'config',
      containerPath: '/home/node/.openclaw',
      readOnly: false,
    })
    expect(mounts).toContainEqual({
      sourceVolume: 'workspace',
      containerPath: '/home/node/.openclaw/workspace',
      readOnly: false,
    })
    expect(mounts).toContainEqual({
      sourceVolume: 'plugin-deps',
      containerPath:
        '/home/node/.openclaw/workspace/.openclaw/plugin-runtime-deps',
      readOnly: false,
    })
  })

  it('uses 180s health-check startPeriod on the gateway (covers init + cold start)', () => {
    // Init-config (~5s) + gateway cold start (~30-60s) + plugin
    // staging (~30-90s) doesn't fit in the prior 20s. 180s gives
    // margin without making real failures take 3+ minutes to surface.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const gateway = findContainer(taskDef, 'gateway')
    expect(gateway?.healthCheck?.startPeriod).toBe(180)
  })

  it('container health check is node-fetch on 127.0.0.1 (mirrors smoke-test; not wget --spider)', () => {
    // Live-validated bug: the prior `wget --spider` form issued HEAD
    // requests, which OpenClaw's /healthz doesn't honor (only GET).
    // Every container health-check probe failed → ECS marked the
    // gateway unhealthy after retries → task replaced → boot loop.
    // node is guaranteed in the image; fetch defaults to GET; the
    // smoke-test has been running this exact pattern healthily.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const gateway = findContainer(taskDef, 'gateway')
    const cmd = gateway?.healthCheck?.command ?? []
    expect(cmd[0]).toBe('CMD')
    expect(cmd[1]).toBe('node')
    expect(cmd[2]).toBe('-e')
    // The script body uses `fetch()` (GET by default) against
    // 127.0.0.1:18789/healthz and exits 0 on r.ok, 1 otherwise.
    // AbortSignal.timeout(4000) bounds a hung loopback connection
    // ~1s before ECS would SIGKILL at the `timeout: 5` boundary.
    const script = cmd[3] ?? ''
    expect(script).toContain("fetch('http://127.0.0.1:18789/healthz'")
    expect(script).toContain('AbortSignal.timeout(4000)')
    expect(script).toContain('r.ok?0:1')
    // Defense-in-depth: catch a regression that puts wget back.
    expect(cmd.join(' ')).not.toContain('wget')
    expect(cmd.join(' ')).not.toContain('--spider')
  })

  it('container health check uses 5 retries (matches smoke-test)', () => {
    // 5 × 30s = 2.5 min of failed checks before ECS pulls the task —
    // gives the gateway room to recover from a transient stall
    // (e.g. plugin-load event-loop spike) without task replacement.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const gateway = findContainer(taskDef, 'gateway')
    expect(gateway?.healthCheck?.retries).toBe(5)
  })

  it('points both containers awslogs-group at the per-agent log group with distinct stream prefixes', () => {
    // Same log group for the whole task; different stream prefixes
    // so init-config and gateway logs are easy to filter in the
    // CloudWatch console. awslogs-region asserted on both — round-2
    // audit on PR #40 caught that the test consolidation lost the
    // region check the old single-container test had.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const init = findContainer(taskDef, 'init-config')
    const gateway = findContainer(taskDef, 'gateway')
    expect(init?.logConfiguration?.options?.['awslogs-group']).toBe(
      '/ecs/ender-stack-dev/companion-openclaw-hello-bot',
    )
    expect(gateway?.logConfiguration?.options?.['awslogs-group']).toBe(
      '/ecs/ender-stack-dev/companion-openclaw-hello-bot',
    )
    expect(init?.logConfiguration?.options?.['awslogs-region']).toBe(
      'us-east-1',
    )
    expect(gateway?.logConfiguration?.options?.['awslogs-region']).toBe(
      'us-east-1',
    )
    expect(init?.logConfiguration?.options?.['awslogs-stream-prefix']).toBe(
      'init-config',
    )
    expect(gateway?.logConfiguration?.options?.['awslogs-stream-prefix']).toBe(
      'gateway',
    )
  })

  it('tags the task-def with Component=agent-harness so Fleet picks it up', () => {
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const tags = taskDef.tags ?? []
    expect(tags).toContainEqual({ key: 'Component', value: 'agent-harness' })
    expect(tags).toContainEqual({ key: 'Harness', value: 'companion/openclaw' })
    expect(tags).toContainEqual({ key: 'AgentName', value: 'hello-bot' })
  })

  it('uses the IAM-aligned task + exec role ARNs', () => {
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    expect(taskDef.taskRoleArn).toBe(fixtureEnv.taskRoleArn)
    expect(taskDef.executionRoleArn).toBe(fixtureEnv.executionRoleArn)
  })
})

describe('renderTargetGroup', () => {
  it('uses the prefix-agent-{name} pattern (singular agent vs plural agents on the LB)', () => {
    const tg = renderTargetGroup(fixtureInput, fixtureEnv)
    expect(tg.Name).toBe('ender-stack-dev-agent-hello-bot')
  })

  it('uses /healthz on port 18789 (matches OpenClaw gateway)', () => {
    const tg = renderTargetGroup(fixtureInput, fixtureEnv)
    expect(tg.HealthCheckPath).toBe('/healthz')
    expect(tg.Port).toBe(18789)
    expect(tg.HealthCheckPort).toBe('traffic-port')
  })

  it('targets IPs (awsvpc tasks register by IP, not instance ID)', () => {
    const tg = renderTargetGroup(fixtureInput, fixtureEnv)
    expect(tg.TargetType).toBe('ip')
  })
})

describe('renderService', () => {
  it('uses the prefix-companion-openclaw-{name} pattern matching IAM CreateService scope', () => {
    const svc = renderService(fixtureInput, fixtureEnv, {
      taskDefinitionArn: 'arn:aws:ecs:us-east-1:398152419239:task-definition/x:1',
      targetGroupArn:
        'arn:aws:elasticloadbalancing:us-east-1:398152419239:targetgroup/ender-stack-dev-agent-hello-bot/abc',
    })
    expect(svc.serviceName).toBe(
      'ender-stack-dev-companion-openclaw-hello-bot',
    )
  })

  it('binds the gateway container on the right port for ALB target registration', () => {
    const svc = renderService(fixtureInput, fixtureEnv, {
      taskDefinitionArn: 'arn:tdf',
      targetGroupArn: 'arn:tg',
    })
    const lb = svc.loadBalancers?.[0]
    expect(lb?.containerName).toBe('gateway')
    expect(lb?.containerPort).toBe(18789)
  })

  it('runs in private subnets with assignPublicIp DISABLED', () => {
    const svc = renderService(fixtureInput, fixtureEnv, {
      taskDefinitionArn: 'arn:tdf',
      targetGroupArn: 'arn:tg',
    })
    const cfg = svc.networkConfiguration?.awsvpcConfiguration
    expect(cfg?.assignPublicIp).toBe('DISABLED')
    expect(cfg?.subnets).toEqual(['subnet-1', 'subnet-2'])
    expect(cfg?.securityGroups).toEqual(['sg-ecs'])
  })

  it('explicitly disables ECS Exec — operator privilege escalation vector', () => {
    const svc = renderService(fixtureInput, fixtureEnv, {
      taskDefinitionArn: 'arn:tdf',
      targetGroupArn: 'arn:tg',
    })
    expect(svc.enableExecuteCommand).toBe(false)
  })

  it('uses 300s healthCheckGracePeriodSeconds (must be ≥ task startPeriod 180s)', () => {
    // #215: service grace must cover the task healthCheck startPeriod
    // (180s) + the first health-check window after it expires.
    // Setting service grace below task start period would cause ECS
    // to start replacing tasks before they ever finish booting —
    // rollout enters a kill-loop. 300s = 180s start + 120s margin.
    const svc = renderService(fixtureInput, fixtureEnv, {
      taskDefinitionArn: 'arn:tdf',
      targetGroupArn: 'arn:tg',
    })
    expect(svc.healthCheckGracePeriodSeconds).toBe(300)
  })

  it('service grace > task startPeriod (machine-checked invariant — round-1 audit)', () => {
    // The kill-loop invariant: service must give the task more time
    // to become healthy than the task itself reports as "still
    // starting." Future tuning of either knob in isolation would
    // silently break this; this test fires if grace ≤ startPeriod.
    const taskDef = renderTaskDefinition(fixtureInput, fixtureEnv)
    const gateway = taskDef.containerDefinitions?.find(
      (c) => c.name === 'gateway',
    )
    const startPeriod = gateway?.healthCheck?.startPeriod
    const svc = renderService(fixtureInput, fixtureEnv, {
      taskDefinitionArn: 'arn:tdf',
      targetGroupArn: 'arn:tg',
    })
    const grace = svc.healthCheckGracePeriodSeconds
    expect(typeof startPeriod).toBe('number')
    expect(typeof grace).toBe('number')
    expect(grace!).toBeGreaterThan(startPeriod!)
  })
})

describe('renderListenerRule', () => {
  it('emits two explicit path patterns to avoid prefix-pair collisions', () => {
    const rule = renderListenerRule(fixtureInput, fixtureEnv, {
      targetGroupArn: 'arn:tg',
      priority: 1234,
    })
    // Two patterns: exact-name root + subtree. Prevents `/agent/bot-test/api`
    // from matching a `/agent/bot*` glob and silently routing to `bot`.
    expect(rule.pathPatterns).toEqual([
      '/agent/hello-bot',
      '/agent/hello-bot/*',
    ])
    expect(rule.targetGroupArn).toBe('arn:tg')
    expect(rule.priority).toBe(1234)
  })
})

describe('HARNESS_TEMPLATES.companion/openclaw validateInput', () => {
  const validate =
    HARNESS_TEMPLATES['companion/openclaw'].validateInput

  it('accepts a valid agent name', () => {
    expect(() => validate(fixtureInput)).not.toThrow()
  })

  it('rejects agent name shorter than 3 chars', () => {
    expect(() => validate({ ...fixtureInput, agentName: 'ab' })).toThrow(
      /agentName/,
    )
  })

  it('rejects agent name longer than 20 chars (#134: IAM role-name budget)', () => {
    // 20-char ceiling lets the combined IAM role name
    // `ender-stack-staging-companion-openclaw-{agent}-task` fit
    // under AWS's 64-char role-name limit in the longest realistic
    // staging-prefix deployment.
    expect(() =>
      validate({ ...fixtureInput, agentName: 'a'.repeat(21) }),
    ).toThrow(/agentName/)
  })

  it('accepts agent name at exactly 20 chars (boundary)', () => {
    expect(() =>
      validate({ ...fixtureInput, agentName: 'a' + 'b'.repeat(18) + 'c' }),
    ).not.toThrow()
  })

  it('rejects uppercase characters', () => {
    expect(() => validate({ ...fixtureInput, agentName: 'Hello' })).toThrow(
      /agentName/,
    )
  })

  it('rejects characters outside [a-z0-9-]', () => {
    expect(() => validate({ ...fixtureInput, agentName: 'hello_world' })).toThrow(
      /agentName/,
    )
    expect(() => validate({ ...fixtureInput, agentName: 'hello.world' })).toThrow(
      /agentName/,
    )
  })

  it('rejects names starting with a hyphen', () => {
    expect(() => validate({ ...fixtureInput, agentName: '-hello' })).toThrow(
      /agentName/,
    )
  })

  it('rejects names ending with a hyphen', () => {
    expect(() => validate({ ...fixtureInput, agentName: 'hello-' })).toThrow(
      /agentName/,
    )
  })

  it('rejects names that are only hyphens', () => {
    expect(() => validate({ ...fixtureInput, agentName: '---' })).toThrow(
      /agentName/,
    )
  })

  it('accepts names starting with a digit (e.g. date prefixes like `2026-04-30-bot`)', () => {
    // Beat 3b.1 relaxed AGENT_NAME_RE from `[a-z][a-z0-9-]{1,30}[a-z0-9]`
    // to `[a-z0-9][a-z0-9-]{1,30}[a-z0-9]`. AWS doesn't require
    // letter-start for any of the resources MC creates; the prior
    // restriction blocked legitimate operator names like dated
    // builds.
    expect(() =>
      validate({ ...fixtureInput, agentName: '2026-04-30-bot' }),
    ).not.toThrow()
    expect(() => validate({ ...fixtureInput, agentName: '1abc' })).not.toThrow()
  })

  it('accepts names with internal hyphens and digits', () => {
    expect(() =>
      validate({ ...fixtureInput, agentName: 'bot-v2-prod' }),
    ).not.toThrow()
  })

  it('rejects an image without a tag/digest separator', () => {
    expect(() => validate({ ...fixtureInput, image: 'untagged-image' })).toThrow(
      /image/,
    )
  })

  it('rejects an image with a separator but empty tag (server-side, mirrors client check)', () => {
    // Round-9 audit: client form catches `img:` already, but a direct
    // POST that bypasses the form needs the same protection — otherwise
    // it surfaces as an AWS-layer InvalidParameterException 502 instead
    // of a clean 400 ValidationError.
    expect(() =>
      validate({
        ...fixtureInput,
        image: 'ghcr.io/stroupaloop/openclaw:',
      }),
    ).toThrow(/image/)
  })

  it('rejects an image from an unallowed registry', () => {
    expect(() =>
      validate({
        ...fixtureInput,
        image: 'docker.io/attacker/malicious:latest',
      }),
    ).toThrow(/registry/)
  })

  it('accepts images from ECR in this account', () => {
    expect(() =>
      validate({
        ...fixtureInput,
        image:
          '398152419239.dkr.ecr.us-east-1.amazonaws.com/ender-stack/openclaw:sha-deadbeef',
      }),
    ).not.toThrow()
  })

  it('accepts images from public ECR', () => {
    expect(() =>
      validate({
        ...fixtureInput,
        image: 'public.ecr.aws/openclaw/openclaw:v1.2.3',
      }),
    ).not.toThrow()
  })

  it('honors MC_FLEET_IMAGE_REGISTRY_ALLOWLIST override', () => {
    const original = process.env.MC_FLEET_IMAGE_REGISTRY_ALLOWLIST
    process.env.MC_FLEET_IMAGE_REGISTRY_ALLOWLIST =
      String.raw`example\.com/`
    try {
      expect(() =>
        validate({
          ...fixtureInput,
          image: 'example.com/some/image:tag',
        }),
      ).not.toThrow()
      // Default-allowed registry now rejected because the override
      // replaces the list rather than appending.
      expect(() =>
        validate({
          ...fixtureInput,
          image: 'ghcr.io/stroupaloop/openclaw:tag',
        }),
      ).toThrow(/registry/)
    } finally {
      if (original === undefined) {
        delete process.env.MC_FLEET_IMAGE_REGISTRY_ALLOWLIST
      } else {
        process.env.MC_FLEET_IMAGE_REGISTRY_ALLOWLIST = original
      }
    }
  })

  it('rejects an empty roleDescription', () => {
    expect(() => validate({ ...fixtureInput, roleDescription: '' })).toThrow(
      /roleDescription/,
    )
    expect(() =>
      validate({ ...fixtureInput, roleDescription: '   ' }),
    ).toThrow(/roleDescription/)
  })

  it('rejects roleDescription > 200 bytes', () => {
    expect(() =>
      validate({ ...fixtureInput, roleDescription: 'a'.repeat(201) }),
    ).toThrow(/roleDescription.*200/)
    expect(() =>
      validate({ ...fixtureInput, roleDescription: 'a'.repeat(200) }),
    ).not.toThrow()
  })

  it('optional persona fields can be absent', () => {
    // Backward compat — clients that don't supply persona fields must
    // still pass validation.
    expect(() => validate({ ...fixtureInput })).not.toThrow()
  })

  it('persona fields accept reasonable values', () => {
    expect(() =>
      validate({
        ...fixtureInput,
        displayName: 'Aria',
        persona: 'Direct, opinionated. Skip filler.\n\nDisagree when warranted.',
      }),
    ).not.toThrow()
  })

  it('rejects displayName / persona over the byte cap', () => {
    expect(() =>
      validate({ ...fixtureInput, displayName: 'a'.repeat(65) }),
    ).toThrow(/displayName.*64/)
    expect(() =>
      validate({ ...fixtureInput, persona: 'p'.repeat(1025) }),
    ).toThrow(/persona.*1024/)
  })

  it('rejects multi-byte input over the UTF-8 byte cap (not just code units)', () => {
    // Validation must use Buffer.byteLength (UTF-8), not `.length`
    // (UTF-16 code units). 33 fox emojis are 33 code units but 132
    // UTF-8 bytes — without the byte-aware check, displayName would
    // pass the form but exceed the server cap.
    const foxName = '🦊'.repeat(33)
    expect(() =>
      validate({ ...fixtureInput, displayName: foxName }),
    ).toThrow(/displayName.*64/)

    // A persona of 700 é characters is 700 code units (passes 1024
    // code-unit cap) but 1400 UTF-8 bytes (exceeds 1024 byte cap).
    const accentedPersona = 'é'.repeat(700)
    expect(() =>
      validate({ ...fixtureInput, persona: accentedPersona }),
    ).toThrow(/persona.*1024/)

    // Boundary: 50 ASCII chars + 7 é = 50 + 14 = 64 bytes exactly.
    // Within the displayName cap.
    expect(() =>
      validate({ ...fixtureInput, displayName: 'a'.repeat(50) + 'é'.repeat(7) }),
    ).not.toThrow()
  })

  it('rejects markdown list-item prefix in displayName and roleDescription', () => {
    // The prefix check applies to displayName (single-line) AND
    // roleDescription (multi-line, but checked on TRIMMED START only).
    // Both land in IDENTITY.md as bullet content; a leading `- foo`
    // would render as a structural net-new bullet after init-config
    // collapses newlines.
    for (const prefix of ['- inject', '* inject', '+ inject', '1. inject', '99. inject']) {
      expect(() =>
        validate({ ...fixtureInput, displayName: prefix }),
        `displayName="${prefix}" should reject`,
      ).toThrow(/displayName.*list-item prefix/)
      expect(() =>
        validate({ ...fixtureInput, roleDescription: prefix }),
        `roleDescription="${prefix}" should reject`,
      ).toThrow(/roleDescription.*list-item prefix/)
    }

    // Leading whitespace + prefix must also reject (trim-then-check).
    expect(() =>
      validate({ ...fixtureInput, displayName: '   - inject' }),
    ).toThrow(/displayName.*list-item prefix/)
    expect(() =>
      validate({ ...fixtureInput, roleDescription: '   - inject' }),
    ).toThrow(/roleDescription.*list-item prefix/)

    // Internal `- foo` line in roleDescription is fine — the prefix
    // check is on the TRIMMED START only, not every line.
    expect(() =>
      validate({
        ...fixtureInput,
        roleDescription: 'Senior on-call engineer\n- handles P0 incidents',
      }),
    ).not.toThrow()

    // Embedded "1." in the middle is fine.
    expect(() =>
      validate({ ...fixtureInput, displayName: 'Tier 1. SRE Lead' }),
    ).not.toThrow()
  })

  it('rejects ASCII control chars in displayName (single-line field)', () => {
    // displayName lands in IDENTITY.md as a single-line bullet — any
    // control char (including LF and tab) is rejected.
    expect(() =>
      validate({ ...fixtureInput, displayName: 'two\nlines' }),
    ).toThrow(/displayName.*control characters/)
    expect(() =>
      validate({ ...fixtureInput, displayName: 'tab\there' }),
    ).toThrow(/displayName.*control characters/)
  })

  it('roleDescription + persona ALLOW LF / tab (prose semantics)', () => {
    // roleDescription is rendered as a <textarea rows={4}> in the form
    // — operators legitimately enter multi-line prose. LF/tab in the
    // middle of the value is fine; init-config's normField collapses
    // line breaks to a single space before IDENTITY.md substitution,
    // so the multi-line value lands as a clean single-line bullet.
    // (The leading-list-prefix check is on the TRIMMED START only, so
    // a multi-line value whose first line is plain prose passes.)
    expect(() =>
      validate({ ...fixtureInput, roleDescription: 'multi-line\nrole' }),
    ).not.toThrow()
    expect(() =>
      validate({ ...fixtureInput, roleDescription: 'tab\there' }),
    ).not.toThrow()
    // persona: same posture.
    expect(() =>
      validate({ ...fixtureInput, persona: 'p1\n\np2\n\tindented' }),
    ).not.toThrow()
    // Non-LF/non-tab control chars still rejected in both.
    expect(() =>
      validate({ ...fixtureInput, roleDescription: 'has \x07 bell' }),
    ).toThrow(/roleDescription.*control characters/)
    expect(() =>
      validate({ ...fixtureInput, persona: 'has \x07 bell' }),
    ).toThrow(/persona.*control characters/)
  })

  it('#376: accepts known archetype slug + valid owner fields', () => {
    expect(() =>
      validate({
        ...fixtureInput,
        archetype: 'software-engineer',
        ownerName: 'Andrew Stroup',
        ownerSlackId: 'U01ABCDEF23',
        ownerTimezone: 'America/New_York',
      }),
    ).not.toThrow()
  })

  it('#376: rejects unknown archetype slug (allowlist check via ARCHETYPE_SLUGS)', () => {
    expect(() =>
      validate({ ...fixtureInput, archetype: 'not-a-real-archetype' }),
    ).toThrow(/archetype.*not in the known archetype set/)
  })

  it('#376: rejects archetype that fails the slug regex (uppercase, path-traversal, etc.)', () => {
    expect(() =>
      validate({ ...fixtureInput, archetype: 'UPPERCASE' }),
    ).toThrow(/archetype must match/)
    expect(() =>
      validate({ ...fixtureInput, archetype: '../etc/passwd' }),
    ).toThrow(/archetype must match/)
    expect(() =>
      validate({ ...fixtureInput, archetype: '-leading-hyphen' }),
    ).toThrow(/archetype must match/)
  })

  it('#376: accepts the custom archetype slug', () => {
    // custom is the explicit "no scaffold" choice — must be in the
    // allowlist so operators can pick it.
    expect(() =>
      validate({ ...fixtureInput, archetype: 'custom' }),
    ).not.toThrow()
  })

  it('#376: rejects ownerName over the byte cap', () => {
    expect(() =>
      validate({ ...fixtureInput, ownerName: 'a'.repeat(201) }),
    ).toThrow(/ownerName.*200/)
  })

  it('#376: rejects ownerSlackId that fails the U[A-Z0-9]{8,} format', () => {
    expect(() =>
      validate({ ...fixtureInput, ownerSlackId: 'u-lowercase-bad' }),
    ).toThrow(/ownerSlackId must match/)
    expect(() =>
      validate({ ...fixtureInput, ownerSlackId: 'W01ABCDEF23' }),
    ).toThrow(/ownerSlackId must match/)
    expect(() =>
      validate({ ...fixtureInput, ownerSlackId: 'U123' }),
    ).toThrow(/ownerSlackId must match/)
  })

  it('#376: accepts a valid Slack user-ID', () => {
    expect(() =>
      validate({ ...fixtureInput, ownerSlackId: 'U01ABCDEF23' }),
    ).not.toThrow()
    // Up to 12 chars after U is accepted (the canonical Slack bound).
    expect(() =>
      validate({ ...fixtureInput, ownerSlackId: 'U07XYZ1234567' }),
    ).not.toThrow()
  })

  it('#494: rejects an owner Slack ID longer than 12 chars after U', () => {
    // OWNER_SLACK_ID_RE was narrowed from {8,} to {8,12} so create-time
    // validation matches the channel-config consumer + init-config.sh's
    // owner-injection filter — an owner accepted here is always one
    // init-config will inject. 13 chars after U must now be rejected.
    expect(() =>
      validate({ ...fixtureInput, ownerSlackId: 'U07XYZ12345678' }),
    ).toThrow(/ownerSlackId must match/)
  })

  it('#376: rejects ownerTimezone over the byte cap', () => {
    expect(() =>
      validate({ ...fixtureInput, ownerTimezone: 'A'.repeat(65) }),
    ).toThrow(/ownerTimezone.*64/)
  })

  it('#376: accepts standard IANA timezone names', () => {
    for (const tz of [
      'America/New_York',
      'Europe/London',
      'Asia/Tokyo',
      'UTC',
      'Pacific/Auckland',
    ]) {
      expect(() =>
        validate({ ...fixtureInput, ownerTimezone: tz }),
      ).not.toThrow()
    }
  })

  it('#376: archetype + owner fields are independently optional', () => {
    // Each can be supplied without the others. Backward compat for
    // legacy task-defs created without #376 in scope.
    expect(() =>
      validate({ ...fixtureInput, archetype: 'sdr' }),
    ).not.toThrow()
    expect(() =>
      validate({ ...fixtureInput, ownerName: 'Andrew' }),
    ).not.toThrow()
    expect(() =>
      validate({ ...fixtureInput, ownerSlackId: 'U01ABCDEF23' }),
    ).not.toThrow()
    expect(() =>
      validate({ ...fixtureInput, ownerTimezone: 'America/New_York' }),
    ).not.toThrow()
  })

  it('enforces deployment-aware combined-name cap when prefix is provided (round-2 audit on PR #39)', () => {
    // Round-2 audit on PR #39 relocated the combined-name check
    // from the handler's pre-check INTO validateInput so any future
    // caller of validateOpenClawInput (test helpers, alternative
    // harnesses) gets the same enforcement. Prefix is optional —
    // input-only callers (most tests above) skip the check.
    // For prefix `ender-stack-dev` (15 chars) + `-agent-` (7) = 22
    // overhead → max agentName = 10. `a-bit-too-long-12c` is 18
    // chars, well over.
    expect(() =>
      validate(
        { ...fixtureInput, agentName: 'a-bit-too-long-12c' },
        'ender-stack-dev',
      ),
    ).toThrow(/target group name/)
    // Same input without prefix → input-only path → no combined-name
    // check → passes.
    expect(() =>
      validate({ ...fixtureInput, agentName: 'a-bit-too-long-12c' }),
    ).not.toThrow()
    // Within the cap with prefix → passes.
    expect(() =>
      validate({ ...fixtureInput, agentName: 'bot-v2-prd' }, 'ender-stack-dev'),
    ).not.toThrow()
  })
})

describe('AGENT_NAME_MIN_LENGTH ↔ AGENT_NAME_RE coupling', () => {
  // Round-10 audit on PR #39 (P2): AGENT_NAME_MIN_LENGTH is a
  // separate exported constant that the harness-defaults
  // PrefixTooLongForHarness gate compares against. It must stay
  // in sync with the regex's effective minimum (currently
  // `[a-z0-9][a-z0-9-]{1,30}[a-z0-9]` → 3 chars). If the regex
  // is ever relaxed (e.g. to allow 1-char names) without updating
  // the constant, the gate would silently allow misconfigs through.
  // This test makes the coupling machine-checked.
  it('AGENT_NAME_MIN_LENGTH equals the regex effective minimum (3)', () => {
    expect(AGENT_NAME_MIN_LENGTH).toBe(3)
    // 2-char names rejected.
    expect(AGENT_NAME_RE.test('ab')).toBe(false)
    // Boundary: AGENT_NAME_MIN_LENGTH-char names accepted.
    expect(AGENT_NAME_RE.test('abc')).toBe(true)
  })
})
