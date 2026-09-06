type SshCredential = { private_key: string; known_hosts: string }

function registryCredential(repository: string): SshCredential | null {
  if (!process.env.MC_FLY_GIT_SSH_KEYS_JSON) return null
  try {
    const registry = JSON.parse(process.env.MC_FLY_GIT_SSH_KEYS_JSON)
    const value = registry?.[repository]
    return value && typeof value.private_key === 'string' && value.private_key &&
      typeof value.known_hosts === 'string' && value.known_hosts ? value : null
  } catch { return null }
}

/** Select one repository credential; never send the global registry to a worker. */
export function flyRepositoryAuth(repository: string): Record<string, string> {
  const env = process.env
  const credential = registryCredential(repository)
  if (credential) return { MC_FLY_GIT_SSH_REPOSITORY: repository,
    MC_FLY_GIT_SSH_KEY: credential.private_key, MC_FLY_GIT_SSH_KNOWN_HOSTS: credential.known_hosts }
  if (env.MC_FLY_GIT_SSH_REPOSITORY === repository && env.MC_FLY_GIT_SSH_KEY && env.MC_FLY_GIT_SSH_KNOWN_HOSTS) {
    return { MC_FLY_GIT_SSH_REPOSITORY: repository, MC_FLY_GIT_SSH_KEY: env.MC_FLY_GIT_SSH_KEY,
      MC_FLY_GIT_SSH_KNOWN_HOSTS: env.MC_FLY_GIT_SSH_KNOWN_HOSTS }
  }
  return env.MC_FLY_GIT_AUTH_TOKEN ? { MC_FLY_GIT_AUTH_TOKEN: env.MC_FLY_GIT_AUTH_TOKEN } : {}
}
