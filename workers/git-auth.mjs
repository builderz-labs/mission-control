import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { cleanEnvironment } from './process.mjs'

export async function withGitAuth(repository, operation) {
  const env = cleanEnvironment()
  if (process.env.MC_FLY_GIT_SSH_REPOSITORY !== repository || !process.env.MC_FLY_GIT_SSH_KEY) {
    if (process.env.MC_FLY_GIT_AUTH_TOKEN) {
      env.MC_FLY_GIT_AUTH_TOKEN = process.env.MC_FLY_GIT_AUTH_TOKEN
      env.GIT_ASKPASS = `node ${fileURLToPath(new URL('./git-askpass.mjs', import.meta.url))}`
    }
    return operation(env)
  }
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repository) || !process.env.MC_FLY_GIT_SSH_KNOWN_HOSTS) {
    throw new Error('Repository SSH credential configuration is incomplete')
  }
  const directory = await mkdtemp('/tmp/mc-git-auth.')
  try {
    await writeFile(`${directory}/key`, process.env.MC_FLY_GIT_SSH_KEY.trim() + '\n', {mode:0o600})
    await writeFile(`${directory}/known_hosts`, process.env.MC_FLY_GIT_SSH_KNOWN_HOSTS.trim() + '\n', {mode:0o600})
    env.GIT_SSH_COMMAND = `ssh -F /dev/null -o IdentityAgent=none -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o GlobalKnownHostsFile=/dev/null -o UserKnownHostsFile=${directory}/known_hosts -o ConnectTimeout=15 -i ${directory}/key`
    env.GIT_CONFIG_COUNT = '1'
    env.GIT_CONFIG_KEY_0 = `url.ssh://git@github.com/${repository.slice('https://github.com/'.length)}.insteadOf`
    env.GIT_CONFIG_VALUE_0 = repository
    return await operation(env)
  } finally {
    await rm(directory, {recursive:true,force:true})
  }
}

export function clearGitCredentials() {
  for (const name of ['MC_FLY_GIT_AUTH_TOKEN','MC_FLY_GIT_SSH_KEY','MC_FLY_GIT_SSH_KNOWN_HOSTS','MC_FLY_GIT_SSH_REPOSITORY']) delete process.env[name]
}
