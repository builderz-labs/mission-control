import type {
  RegisterTaskDefinitionCommandInput,
  CreateServiceCommandInput,
} from '@aws-sdk/client-ecs'
import type { CreateTargetGroupCommandInput } from '@aws-sdk/client-elastic-load-balancing-v2'

/**
 * OpenClaw companion harness — task-def + ECS service + ALB target group
 * templates rendered from `/fleet/new` form input.
 *
 * Each template emits the exact AWS SDK input objects the create-agent
 * handler passes to RegisterTaskDefinition / CreateService / CreateTargetGroup.
 * Naming is load-bearing — the IAM grants in
 * ender-stack/terraform/modules/iam/main.tf authorize MC against ARN
 * patterns derived from `{prefix}-companion-openclaw-{name}`. Drift
 * between the templated names here and the IAM scopes will silently 403.
 *
 * Two-container task shape (init-config + gateway, dependsOn-gated)
 * with three ephemeral Fargate volumes (config, workspace, plugin-deps).
 * Resolves ender-stack#215. Mirrors the smoke-test pattern at
 * ender-stack/terraform/modules/companion/openclaw/main.tf except for
 * the storage backing — smoke-test uses EFS, MC-created agents use
 * Fargate ephemeral. The all-ephemeral choice fits the platform's
 * external-state architecture (durable state lives in Mem0/KB/S3,
 * not local disk); see research/openclaw-storage-convergence.md
 * (filed alongside this PR's ender-stack-side companion if any).
 *
 * Phase-1 boot mode: gateway runs with `--allow-unconfigured`
 * (baked into the image's entrypoint.sh). The init-config sidecar
 * pre-creates `OPENCLAW_STATE_DIR` and its known-required subdirs
 * (plugin-runtime-deps, agents, canvas) so OpenClaw's non-recursive
 * mkdir at startup doesn't ENOENT against an empty mount. No
 * openclaw.json is written today — schema-aware templating is its
 * own multi-day investigation deferred to a Phase-2.x follow-up.
 *
 * Per-agent extensions, persona configs, and channel-token binding
 * land in Phase 2.4 (#247) — Slack app manifest + per-agent
 * credential paste-back flow.
 */

/**
 * Validated form input for an OpenClaw create-agent request.
 *
 * agentName regex `AGENT_NAME_RE` (constraints.ts —
 * `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`) is enforced server-side at the
 * handler boundary BEFORE this template is rendered. The IAM policy doc
 * for `task_ecs_write` (ender-stack PR #208) explicitly cites this regex
 * as a load-bearing security control: ecs:RegisterTaskDefinition is
 * granted Resource:"*" because the AWS verb has no resource-level auth,
 * so the only thing keeping a compromised MC from registering arbitrary
 * task-def families is THIS regex. Treat it accordingly.
 */
export interface OpenClawAgentInput {
  /** Unique identifier (`AGENT_NAME_RE` from constraints.ts). Becomes the suffix on every per-agent ARN. */
  agentName: string
  /** Operator-facing role description, surfaced in MC's agent detail panel. */
  roleDescription: string
  /** Container image (full ECR or GHCR URI with digest or tag). */
  image: string
  // Note: modelTier (and the OPENCLAW_MODEL env var) was removed in
  // Beat 3b.1. LiteLLM's smart-router is the authoritative model-
  // selection layer — the agent calls LITELLM_API_BASE and the router
  // picks the optimal model per request. A pinned model tier on the
  // agent task-def would either be ignored (smart-router still routes)
  // or actively conflict (agent forces a model that smart-router
  // would have routed elsewhere for cost/latency). Either way, dead
  // surface. If a future use case needs per-agent model HINTS, add a
  // structured preference field rather than a single tier — the
  // present "tier" framing was already at the wrong abstraction
  // level vs. how the routing layer thinks about model selection.
  // Note: slackWebhookUrl removed in this template version. A Slack
  // webhook is a bearer token; storing it as a plaintext env var on a
  // task-def revision means anyone with `ecs:DescribeTaskDefinition`
  // (CI, monitoring, dev roles) can read it, and revisions are
  // immutable + retained indefinitely. Slack provisioning lands with
  // Phase 2.5's secrets-manager-aware Slack-app-factory work
  // (memory: project_phase2_platform_decisions.md). For Phase 2.2
  // operator-driven deploys, attach the Slack webhook via task-def
  // edit + Secrets Manager binding after the agent is running.
}

/**
 * Environment / cluster context resolved by the handler from
 * MC_FLEET_* env vars before calling the template. Decoupling these
 * from the template lets unit tests render with stable fixture values.
 */
export interface OpenClawAgentEnv {
  /** AWS region (e.g., 'us-east-1'). */
  region: string
  /** `{project}-{environment}` (e.g., 'ender-stack-dev'). Drives every per-agent name. */
  prefix: string
  /** ECS cluster name; equal to prefix in the current Terraform composition. */
  clusterName: string
  /** ARN of the shared OpenClaw task role MC-managed agents share. */
  taskRoleArn: string
  /** ARN of the shared OpenClaw exec role. */
  executionRoleArn: string
  /** CloudWatch log group prefix (e.g., '/ecs/ender-stack-dev'). The handler
   *  must create the log group at `${logGroupPrefix}/companion-openclaw-${agentName}`
   *  before CreateService — agent boot will tail-fail otherwise. */
  logGroupPrefix: string
  /** VPC ID for the per-agent target group. */
  vpcId: string
  /** Private app subnet IDs the ECS service will run in. Comma-joined string at runtime. */
  subnetIds: string[]
  /** ECS-services security group ID (already permits ALB→agent traffic). */
  securityGroupId: string
  /** LiteLLM ALB DNS — passed to the agent as `LITELLM_BASE_URL`. */
  litellmAlbDnsName: string
  /**
   * ARN of the per-agent LiteLLM virtual-key Secrets Manager entry
   * (#354). The create-agent handler resolves the master key,
   * calls LiteLLM `/key/generate` to mint a scoped virtual key
   * with a budget cap + model allowlist, writes it to Secrets
   * Manager at `${project}/${env}/companion-openclaw-{agent}-litellm-key`,
   * and passes the resulting ARN here. The template attaches it
   * as `LITELLM_VIRTUAL_KEY` on both containers so init-config.sh
   * can substitute it into `models.providers.openai.apiKey` and
   * the gateway can use it for outbound LiteLLM calls.
   *
   * Optional only for the test render-only path (where the secret
   * isn't provisioned). At runtime the create-agent handler always
   * supplies it — a `/key/generate` failure aborts the create
   * before this template is invoked, so a missing ARN here in the
   * runtime path means the handler has drifted.
   *
   * The master key never reaches the agent task-def — it's
   * MC-internal auth for the LiteLLM management API only.
   */
  litellmAgentKeySecretArn?: string
  /** Mandatory tags to merge into every created resource (`Project`, `Environment`, `Owner`, `ManagedBy`). */
  tags: Record<string, string>
}

const CONTAINER_PORT = 18789
const HEALTHCHECK_PATH = '/healthz'

/** Resource name = task-def family = ECS service name = TG name suffix. */
function resourceName(prefix: string, agentName: string): string {
  return `${prefix}-companion-openclaw-${agentName}`
}

/** Convert the `Record<string, string>` tag input into the ECS / ELBv2 list format. */
function tagsToEcs(
  tags: Record<string, string>,
): { key: string; value: string }[] {
  return Object.entries(tags).map(([key, value]) => ({ key, value }))
}
function tagsToElbv2(
  tags: Record<string, string>,
): { Key: string; Value: string }[] {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }))
}

/**
 * Mount path constants — used by both the init-config and gateway
 * containers. These match the upstream OpenClaw image's expected
 * layout (verified against the smoke-test task-def in
 * ender-stack/terraform/modules/companion/openclaw/main.tf): config
 * lives at `/home/node/.openclaw`, the workspace mount nests inside
 * it at `/home/node/.openclaw/workspace`, and plugin staging is a
 * dedicated mount under the workspace tree to isolate it from any
 * future workspace-storage-backing changes (smoke-test originally
 * hit stale-lock crashes when plugin staging shared an EFS volume
 * with workspace state — see ender-stack#207).
 *
 * STATE_DIR and PLUGIN_DEPS_MOUNT_PATH are derived from
 * WORKSPACE_MOUNT_PATH rather than re-declared as independent
 * literals so an image-layout change can't drift one path against
 * the others. Single edit point per path component.
 */
const CONFIG_MOUNT_PATH = '/home/node/.openclaw'
const WORKSPACE_MOUNT_PATH = `${CONFIG_MOUNT_PATH}/workspace`
const STATE_DIR = `${WORKSPACE_MOUNT_PATH}/.openclaw`
const PLUGIN_DEPS_MOUNT_PATH = `${STATE_DIR}/plugin-runtime-deps`

/**
 * Renders RegisterTaskDefinition input. The task-def family resolves to
 * `{prefix}-companion-openclaw-{agentName}` and matches the IAM
 * authorization patterns (`task-definition/{prefix}-companion-*:*`).
 *
 * Two-container shape: init-config sidecar (essential=false, exits 0
 * after pre-creating state dirs) + gateway (essential=true, depends
 * on init-config SUCCESS). Three ephemeral Fargate volumes (config,
 * workspace, plugin-deps) — see the mount-path constants above.
 */
export function renderTaskDefinition(
  input: OpenClawAgentInput,
  env: OpenClawAgentEnv,
): RegisterTaskDefinitionCommandInput {
  const name = resourceName(env.prefix, input.agentName)
  const logGroup = `${env.logGroupPrefix}/companion-openclaw-${input.agentName}`

  // Two env blocks: vars common to both containers, and gateway-only
  // additions. Splitting makes "what each container actually
  // consumes" legible from the template — init-config doesn't read
  // OPENCLAW_ROLE_DESCRIPTION or LITELLM_API_BASE, so they're not
  // injected there. (Same task-def-level blast radius regardless,
  // since `ecs:DescribeTaskDefinition` returns the whole revision.)
  //
  // commonEnv: read by both containers' processes.
  //   - OPENCLAW_AGENT_NAME / AGENT_NAME — agent identity (init-config.sh
  //     reads AGENT_NAME today; OPENCLAW_AGENT_NAME kept for the
  //     namespaced form and gateway-runtime use).
  //   - OPENCLAW_STATE_DIR — load-bearing on both: init-config uses it
  //     to know where to mkdir state subdirs; gateway uses it so
  //     OpenClaw's mutable-state writes land on the RW workspace mount.
  // Beat 5e fix: LITELLM_BASE_URL must reach BOTH containers —
  // init-config.sh templates `models.providers.openai.baseUrl`
  // into the rendered openclaw.json (init container), and the
  // gateway runtime reads the same value when making model
  // calls. Previously only on the gateway as `LITELLM_API_BASE`,
  // which the bundled init-config.sh's template substitution
  // ignored (name mismatch with `${LITELLM_BASE_URL}` in
  // openclaw.template.json). Result: agents fell back to
  // OpenAI default with no API key → silent no-reply on Slack
  // mentions.
  //
  // http:// is intentional — internal-only ALB (private subnets,
  // internal=true, no ACM cert). Don't "fix" to https without
  // coordinating ACM Private CA provisioning.
  const commonEnv = [
    { name: 'OPENCLAW_AGENT_NAME', value: input.agentName },
    { name: 'AGENT_NAME', value: input.agentName },
    { name: 'OPENCLAW_STATE_DIR', value: STATE_DIR },
    { name: 'LITELLM_BASE_URL', value: `http://${env.litellmAlbDnsName}` },
  ]

  // gatewayOnlyEnv: vars the runtime gateway process consumes.
  //
  // OPENCLAW_ROLE_DESCRIPTION becomes part of the agent's runtime
  // role prompt. Admin-supplied free text written into a task-def
  // revision (AWS retains revisions indefinitely; anyone with
  // ecs:DescribeTaskDefinition can read). Treat as a permanent
  // prompt-injection surface: a crafted description survives
  // container restarts and survives the agent itself. Mitigations:
  // endpoint is admin-only; ROLE_DESCRIPTION_MAX_BYTES caps blast
  // radius; Beat 3b form surfaces operator guidance at submit time.
  // Multi-operator approval is a Phase 2.x hardening follow-up.
  const gatewayOnlyEnv = [
    { name: 'OPENCLAW_ROLE_DESCRIPTION', value: input.roleDescription },
  ]

  // #354: secrets[] entries common to both containers.
  // LITELLM_VIRTUAL_KEY is the agent's per-agent LiteLLM virtual
  // key — minted by MC's create-agent handler via /key/generate
  // and stored at `${project}/${env}/companion-openclaw-{agent}-litellm-key`.
  // The handler aborts the create with 502 before invoking this
  // template if /key/generate fails, so in the runtime path the
  // ARN is always set. When unset (test render-only paths) the
  // entry is dropped — gateway boot fails loud with `apiKey: ""`
  // rather than silently falling back to OpenAI defaults.
  //
  // The LiteLLM master key never reaches the task-def in the
  // post-#354 world. It's MC-internal auth for the management
  // API only.
  const litellmSecrets = env.litellmAgentKeySecretArn
    ? [
        {
          name: 'LITELLM_VIRTUAL_KEY',
          valueFrom: env.litellmAgentKeySecretArn,
        },
      ]
    : []

  const logConfig = (streamPrefix: string) => ({
    logDriver: 'awslogs' as const,
    options: {
      'awslogs-group': logGroup,
      'awslogs-region': env.region,
      'awslogs-stream-prefix': streamPrefix,
    },
  })

  return {
    family: name,
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu: '512',
    memory: '1024',
    taskRoleArn: env.taskRoleArn,
    executionRoleArn: env.executionRoleArn,
    // Three ephemeral Fargate volumes. No `efsVolumeConfiguration` ⇒
    // emptyDir-like overlay backed by Fargate's 21 GiB ephemeral
    // storage. Resets every task launch — config is rebuilt by the
    // init-config sidecar each boot, workspace state is intentionally
    // ephemeral (durable state lives in Mem0/KB/S3 per platform-
    // decisions, not local disk). plugin-deps is its own volume
    // (NOT nested under workspace) to mirror the smoke-test pattern:
    // a future workspace-EFS switch shouldn't drag plugin staging
    // onto EFS.
    volumes: [{ name: 'config' }, { name: 'workspace' }, { name: 'plugin-deps' }],
    containerDefinitions: [
      // init-config sidecar — does the minimum filesystem prep needed
      // for the gateway to boot cleanly on Fargate ephemeral storage:
      //   1. mkdir -p OPENCLAW_STATE_DIR + the upstream-required
      //      state subdirs (plugin-runtime-deps, agents, canvas) so
      //      OpenClaw's non-recursive mkdir at startup doesn't ENOENT
      //   2. chown the workspace + plugin-deps volume roots to
      //      uid 1000 (node user) so the gateway can write
      //
      // **Why inline (not the bundled `/usr/local/bin/init-config.sh`)**:
      // Fargate ephemeral volumes mount with root ownership (no
      // equivalent of EFS access points' `posixUser` setting). The
      // bundled script is designed for the smoke-test's EFS-backed
      // path where access-point posixUser=1000 forces correct
      // ownership at mount time, and the script then runs as the
      // image's default `node` user (uid 1000). On ephemeral, that
      // same script's `mkdir` would fail "Permission denied" because
      // the workspace mount root is owned by root.
      //
      // To make ephemeral work, init-config runs as **root**
      // (`user: '0'`) with an inline command that does the mkdir +
      // chown chain, then exits 0. The gateway container still runs
      // as the image default (node, uid 1000) and inherits writable
      // dirs.
      //
      // The smoke-test (Terraform-bootstrapped) keeps using the
      // bundled init-config.sh + EFS access points — both paths
      // remain healthy. The two paths diverge here intentionally.
      //
      // TODO: converge with the bundled init-config.sh in
      // ender-stack/services/companion/openclaw/init/. The likely
      // path is updating that script to detect ephemeral-vs-EFS
      // (e.g. by checking ownership of the mount root) and run
      // the chown step when needed, then both this template and
      // the smoke-test task-def can call the same script.
      //
      // Gateway's `dependsOn: SUCCESS` ensures it doesn't start
      // until this sidecar exits 0. mkdir + chown failures abort
      // the task launch cleanly with the failure visible in the
      // init-config CloudWatch stream.
      {
        name: 'init-config',
        image: input.image,
        essential: false,
        // Run as root so chown/mkdir work against the ephemeral
        // volume roots (which mount as root-owned by default). The
        // gateway container still runs as the image's default
        // `node` user — `user` is per-container in ECS task-defs.
        user: '0',
        entryPoint: ['/bin/sh', '-c'],
        command: [
          [
            // Pre-create state subdirs OpenClaw expects but doesn't
            // recursively mkdir at runtime. The plugin-runtime-deps
            // entry is a no-op — ECS has already mounted the
            // plugin-deps volume at that path so the directory
            // exists; kept in the list for readability and symmetry.
            `mkdir -p ${STATE_DIR}/plugin-runtime-deps ${STATE_DIR}/agents ${STATE_DIR}/canvas`,
            // Belt-and-suspenders cleanup; ephemeral volumes are
            // empty per task launch so this is normally a no-op
            // but mirrors the bundled script's intent.
            `rm -f ${CONFIG_MOUNT_PATH}/openclaw.json`,
            // Hand the workspace + config volumes to the node user
            // so the gateway can write. `chown -R` on Linux does
            // NOT stop at mount boundaries, and plugin-deps is
            // mounted in this container under workspace at
            // ${PLUGIN_DEPS_MOUNT_PATH} (see mountPoints below —
            // the recursion only covers it because plugin-deps is
            // mounted here; without that mount the path would be
            // a bare directory on workspace, not the plugin-deps
            // volume).
            //
            // Beat 5e: CONFIG_MOUNT_PATH chown is now load-bearing
            // because init-config.sh runs as node (via su -m) and
            // writes openclaw.json there. Without this, init-config
            // hits EACCES on /home/node/.openclaw/openclaw.json.tmp
            // and silently falls through to --allow-unconfigured —
            // exactly the bug we hit on the post-PR #301 deploy
            // (caught on agent 260509-1's first task). The config
            // mount is still RO from the gateway's perspective.
            //
            // `id -u node` resolves the node user's UID at runtime
            // from the image itself rather than hardcoding 1000.
            // If a future upstream base-image bump changes the node
            // user's UID, this becomes a loud `id: 'node': no such
            // user` failure at the init-config step instead of a
            // silent wrong-ownership boot loop on the gateway.
            `chown -R "$(id -u node):$(id -g node)" ${CONFIG_MOUNT_PATH}`,
            `echo '[init-config] ephemeral perms set — gateway boot cleared'`,
            // Beat 5e: drop privileges back to node and invoke the
            // bundled init-config.sh to template openclaw.json with
            // Slack channels + models providers + agent.model.
            // Without this step the gateway boots
            // --allow-unconfigured (no Slack channel allowlist, no
            // LLM provider config) and falls back to OpenAI defaults
            // with no API key — Slack mentions silently fail with
            // 'No API key found for provider openai'. Running the
            // bundled script as node ensures rendered config files
            // are owned by the gateway's runtime user (uid 1000).
            //
            // ⚠️ -m / --preserve-environment is LOAD-BEARING.
            // Without it, `su` strips OPENCLAW_SLACK_CONFIG_JSON,
            // LITELLM_BASE_URL, and LITELLM_VIRTUAL_KEY from the
            // child process — init-config.sh would render the same
            // 'apiKey: ""' / no-Slack-channels output that this
            // PR is meant to fix (greptile P1 audit on PR #59).
            // `su -m` is portable across util-linux (Debian/
            // Ubuntu) and coreutils variants.
            `su -m node -c /usr/local/bin/init-config.sh`,
          ].join(' && '),
        ],
        environment: commonEnv,
        secrets: litellmSecrets,
        // All three volumes mount on init-config (vs gateway's
        // config-RO + workspace-RW + plugin-deps-RW). init-config
        // needs write+ownership control of all three for the chown
        // step. plugin-deps was previously omitted here because the
        // bundled script didn't need it; the inline command does.
        mountPoints: [
          {
            sourceVolume: 'config',
            containerPath: CONFIG_MOUNT_PATH,
            readOnly: false,
          },
          {
            sourceVolume: 'workspace',
            containerPath: WORKSPACE_MOUNT_PATH,
            readOnly: false,
          },
          {
            // plugin-deps mounted here so the chown -R above
            // traverses into it. The mkdir on
            // ${STATE_DIR}/plugin-runtime-deps is a no-op (the
            // mount point already exists) — the mount's purpose
            // is the chown reach, not the mkdir.
            sourceVolume: 'plugin-deps',
            containerPath: PLUGIN_DEPS_MOUNT_PATH,
            readOnly: false,
          },
        ],
        logConfiguration: logConfig('init-config'),
      },
      {
        name: 'gateway',
        image: input.image,
        essential: true,
        // Gateway waits for init-config to SUCCESS — task launch
        // fails fast if init-config can't prep the mounts.
        dependsOn: [{ containerName: 'init-config', condition: 'SUCCESS' }],
        portMappings: [
          {
            containerPort: CONTAINER_PORT,
            protocol: 'tcp',
          },
        ],
        environment: [...commonEnv, ...gatewayOnlyEnv],
        secrets: litellmSecrets,
        mountPoints: [
          // config mounts read-only — gateway reads openclaw.json
          // (or boots --allow-unconfigured if absent) from this path.
          {
            sourceVolume: 'config',
            containerPath: CONFIG_MOUNT_PATH,
            readOnly: true,
          },
          // workspace mounts RW — OpenClaw writes mutable state
          // (canvas, agents, etc) here. Nested under config's path;
          // ECS overlay handles the nesting correctly. Per-task
          // ephemeral — resets on task restart, durable state lives
          // externally (Mem0/KB/S3).
          {
            sourceVolume: 'workspace',
            containerPath: WORKSPACE_MOUNT_PATH,
            readOnly: false,
          },
          // plugin-deps at the upstream-expected plugin staging
          // path. Separate volume so a future workspace backing
          // change (ephemeral → EFS) doesn't drag plugin staging
          // with it (smoke-test originally hit stale-lock crashes
          // when plugin staging shared EFS with workspace state).
          {
            sourceVolume: 'plugin-deps',
            containerPath: PLUGIN_DEPS_MOUNT_PATH,
            readOnly: false,
          },
        ],
        // Mirror the smoke-test's known-working container health check
        // (terraform/modules/companion/openclaw/main.tf): node-based
        // fetch instead of wget. Two reasons the prior `wget --spider`
        // form failed against a freshly-booted MC-created agent:
        //   1. `--spider` issues a HEAD request; OpenClaw's /healthz
        //      only honors GET, so every probe got a 404/405 and
        //      ECS marked the gateway unhealthy after retries → task
        //      replaced → boot loop.
        //   2. `wget` may not be on the upstream image's PATH for the
        //      runtime user (Alpine base provides BusyBox wget, but
        //      relying on that across base-image bumps is brittle).
        // node is guaranteed present (the image's whole reason for
        // existing) and the smoke-test has been running this exact
        // pattern in dev without health-check kill-loops.
        //
        // Requires Node 18+ for the global `fetch` and
        // `AbortSignal.timeout`. The OpenClaw upstream image has
        // shipped on Node 20+ since 2026.x; if a future base-image
        // rollback drops below Node 18 this probe fails with
        // `ReferenceError: fetch is not defined` at runtime (not at
        // task-def registration), which surfaces in the gateway log
        // stream as a series of failed probes.
        //
        // `AbortSignal.timeout(4000)` aborts the fetch ~1s before
        // ECS would SIGKILL the probe at the `timeout: 5` boundary.
        // Without it, a hung loopback connection produces a
        // SIGKILL-shaped exit (137) instead of a clean exit(1) —
        // both count as health-check failures, but the abort
        // produces cleaner failure semantics for triage.
        healthCheck: {
          command: [
            'CMD',
            'node',
            '-e',
            `fetch('http://127.0.0.1:${CONTAINER_PORT}${HEALTHCHECK_PATH}', { signal: AbortSignal.timeout(4000) }).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
          ],
          interval: 30,
          timeout: 5,
          // 5 retries (vs prior 3) matches smoke-test. Each retry is
          // 30s, so up to 2.5 min of failed checks before ECS pulls
          // the task — gives the gateway room to recover from a
          // transient hiccup (e.g. event-loop stall under plugin
          // load) without losing the task.
          retries: 5,
          // 180s startPeriod covers init-config (~5s) + gateway cold
          // start (~30-60s) + plugin staging (~30-90s) on a cold
          // ephemeral mount. Margin without making real failures
          // take 3+ minutes to surface.
          startPeriod: 180,
        },
        logConfiguration: logConfig('gateway'),
      },
    ],
    tags: tagsToEcs({
      ...env.tags,
      Name: name,
      Component: 'agent-harness',
      Harness: 'companion/openclaw',
      AgentName: input.agentName,
    }),
  }
}

/**
 * AWS hard limit on `aws_lb_target_group.name`. Reaching past this
 * triggers a 400 ValidationError from `CreateTargetGroup` AFTER
 * task-def + log-group have been created — orphaning real billed
 * resources. Validate combined-name length BEFORE the AWS fan-out
 * to fail fast with a clear message.
 */
export const TARGET_GROUP_NAME_MAX_LENGTH = 32

/**
 * Computes the OpenClaw target-group name for a given prefix + agent
 * name. Single source of truth — used by both renderTargetGroup
 * (which produces the actual CreateTargetGroup input) and by the
 * handler-side length-cap pre-check + by the harness-defaults
 * endpoint to compute the per-deployment max agent name length.
 */
export function targetGroupName(prefix: string, agentName: string): string {
  return `${prefix}-agent-${agentName}`
}

/**
 * Returns the maximum legal `agentName` length for a given deployment
 * prefix, accounting for the `{prefix}-agent-` overhead and the AWS
 * 32-char target-group-name limit. Negative or zero result indicates
 * the prefix itself is too long for any usable agent name (the
 * caller should surface a deployment-config error rather than try
 * to validate user input against an impossible limit).
 *
 * For the canonical `ender-stack-dev` prefix: `32 - 22 = 10` chars
 * available for the agent name segment.
 */
export function maxAgentNameLengthForPrefix(prefix: string): number {
  // `{prefix}-agent-` overhead = prefix.length + 1 (dash) + 5 ('agent') + 1 (dash) = prefix.length + 7
  return TARGET_GROUP_NAME_MAX_LENGTH - prefix.length - '-agent-'.length
}

/**
 * Renders CreateTargetGroup input. Name pattern `{prefix}-agent-{agentName}`
 * matches the IAM grant for ELBv2MutateAgentTargetGroups
 * (targetgroup ARN pattern under `{prefix}-agent-` with a wildcard tail).
 *
 * Note the `agent` (singular) vs `agents` (plural) asymmetry — TGs are
 * per-agent, the listener is the shared resource. Same convention as
 * ender-stack/terraform/modules/agents-shared-alb/main.tf.
 */
export function renderTargetGroup(
  input: OpenClawAgentInput,
  env: OpenClawAgentEnv,
): CreateTargetGroupCommandInput {
  return {
    Name: targetGroupName(env.prefix, input.agentName),
    Port: CONTAINER_PORT,
    Protocol: 'HTTP',
    VpcId: env.vpcId,
    TargetType: 'ip',
    HealthCheckPath: HEALTHCHECK_PATH,
    HealthCheckProtocol: 'HTTP',
    HealthCheckPort: 'traffic-port',
    HealthyThresholdCount: 2,
    UnhealthyThresholdCount: 3,
    HealthCheckTimeoutSeconds: 5,
    HealthCheckIntervalSeconds: 30,
    Matcher: { HttpCode: '200' },
    Tags: tagsToElbv2({
      ...env.tags,
      Name: `${env.prefix}-agent-${input.agentName}-tg`,
      Component: 'agent-harness',
      Harness: 'companion/openclaw',
      AgentName: input.agentName,
    }),
  }
}

/**
 * Renders CreateService input. Service name `{prefix}-companion-openclaw-{agentName}`
 * matches the IAM grant for ECSCreateAndDeleteAgentServices
 * (`service/{cluster}/{prefix}-companion-*`).
 *
 * `taskDefinition` is supplied separately by the handler — the registered
 * task-def revision ARN is only known after RegisterTaskDefinition returns.
 * The `loadBalancers[].targetGroupArn` is similarly handler-supplied
 * post-CreateTargetGroup.
 */
export function renderService(
  input: OpenClawAgentInput,
  env: OpenClawAgentEnv,
  resolved: { taskDefinitionArn: string; targetGroupArn: string },
): CreateServiceCommandInput {
  const name = resourceName(env.prefix, input.agentName)

  return {
    cluster: env.clusterName,
    serviceName: name,
    taskDefinition: resolved.taskDefinitionArn,
    desiredCount: 1,
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: env.subnetIds,
        securityGroups: [env.securityGroupId],
        assignPublicIp: 'DISABLED',
      },
    },
    loadBalancers: [
      {
        targetGroupArn: resolved.targetGroupArn,
        containerName: 'gateway',
        containerPort: CONTAINER_PORT,
      },
    ],
    // Service-level grace ≥ task-level startPeriod. Task healthCheck
    // startPeriod is 180s (#215) to cover init-config + gateway cold
    // start + plugin staging. ECS would mark tasks unhealthy and
    // start replacing them at the service-level boundary, so the
    // service grace must be ≥ the task health-check start window or
    // the rollout enters a kill-loop before the task ever has a
    // chance to come up. 300s gives 120s margin over the task start
    // period for the first /healthz pass after the start window
    // expires.
    healthCheckGracePeriodSeconds: 300,
    tags: tagsToEcs({
      ...env.tags,
      Name: name,
      Component: 'agent-harness',
      Harness: 'companion/openclaw',
      AgentName: input.agentName,
    }),
    enableExecuteCommand: false,
  }
}

/**
 * Build the listener-rule input for the shared agents ALB. Path-based
 * routing — two explicit patterns forward to the per-agent target group:
 *   - `/agent/{agentName}`        — exact-name root
 *   - `/agent/{agentName}/*`      — any subpath under the agent
 *
 * The two-pattern shape is load-bearing for prefix-pair agent names.
 * A single `/agent/{name}*` glob would also match a different agent
 * whose name starts with `{name}` (e.g., `bot` + `bot-test` → a
 * request to `/agent/bot-test/api` matches BOTH `/agent/bot*` and
 * `/agent/bot-test*`, and AWS resolves by priority, not specificity —
 * so `bot-test` traffic could silently land on `bot`'s target group).
 * Anchoring with `/{name}` (exact) and `/{name}/*` (subtree) makes the
 * patterns mutually exclusive across distinct agent names. The
 * agentName regex `AGENT_NAME_RE` (constraints.ts —
 * `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`) permits hyphenated names that
 * would trigger this overlap, so the anchoring is required.
 *
 * Priority is computed by the handler from a hash of the agent name;
 * AWS requires unique priorities per listener (collisions are
 * tracked as ender-stack#214).
 */
export interface AgentListenerRuleSpec {
  pathPatterns: string[]
  targetGroupArn: string
  priority: number
  tags: { Key: string; Value: string }[]
}

export function renderListenerRule(
  input: OpenClawAgentInput,
  env: OpenClawAgentEnv,
  resolved: { targetGroupArn: string; priority: number },
): AgentListenerRuleSpec {
  return {
    pathPatterns: [
      `/agent/${input.agentName}`,
      `/agent/${input.agentName}/*`,
    ],
    targetGroupArn: resolved.targetGroupArn,
    priority: resolved.priority,
    tags: tagsToElbv2({
      ...env.tags,
      Name: `${env.prefix}-agent-${input.agentName}-rule`,
      Component: 'agent-harness',
      Harness: 'companion/openclaw',
      AgentName: input.agentName,
    }),
  }
}
