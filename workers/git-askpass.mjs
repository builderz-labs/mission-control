// Git receives this helper only during the bounded fetch/push subprocess.
const prompt = process.argv.slice(2).join(' ')
process.stdout.write(/username/i.test(prompt) ? 'x-access-token\n' : `${process.env.MC_FLY_GIT_AUTH_TOKEN || ''}\n`)


