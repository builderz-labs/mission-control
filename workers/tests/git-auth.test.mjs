import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { withGitAuth, clearGitCredentials } from '../git-auth.mjs'
const repository = 'https://github.com/example/private.git'

test('SSH credentials are repository scoped, temporary, pinned and removed on failure', async () => {
  const saved = {...process.env}
  let directory
  try {
    process.env.MC_FLY_GIT_SSH_REPOSITORY = repository
    process.env.MC_FLY_GIT_SSH_KEY = 'test-private-key'
    process.env.MC_FLY_GIT_SSH_KNOWN_HOSTS = 'github.com ssh-ed25519 test-host'
    delete process.env.MC_FLY_GIT_AUTH_TOKEN
    await withGitAuth('https://github.com/example/public.git', async env => assert.equal(env.GIT_SSH_COMMAND,undefined))
    await assert.rejects(withGitAuth(repository,async env => {
      directory = env.GIT_SSH_COMMAND.match(/-i (\S+)\/key/)[1]
      assert.equal((await stat(`${directory}/key`)).mode & 0o777,0o600)
      assert.equal(await readFile(`${directory}/key`,'utf8'),'test-private-key\n')
      assert.ok(env.GIT_SSH_COMMAND.includes('StrictHostKeyChecking=yes'))
      assert.equal(env.MC_FLY_GIT_SSH_KEY,undefined)
      assert.equal(env.GIT_CONFIG_VALUE_0,repository)
      assert.equal(env.GIT_CONFIG_KEY_0,'url.ssh://git@github.com/example/private.git.insteadOf')
      throw Error('fetch failed')
    }),/fetch failed/)
    await assert.rejects(stat(directory),{code:'ENOENT'})
    clearGitCredentials()
    assert.equal(process.env.MC_FLY_GIT_SSH_KEY,undefined)
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env,saved)
  }
})
