export function packageFailure(label, code, output, env = process.env) {
  const base = `${label} failed (exit ${code ?? 'signal'})`
  if (!/^(Dependency setup|Browser setup|Verification )/.test(label)) return new Error(base)
  let detail = output.split('\n').filter(line => /ERR[!_ ]|error:|not found|EACCES|EAI_AGAIN|fatal:/i.test(line)).slice(-4).join(' ').slice(-1500)
  for (const [name, value] of Object.entries(env)) {
    if (/TOKEN|KEY|PASSWORD|SECRET|AUTH/i.test(name) && value?.length >= 8) detail = detail.split(value).join('[redacted]')
  }
  detail = detail.replace(/https?:\/\/[^\s]+/g, '[url]')
    .replace(/(?:Bearer\s+|(?:token|password|api[_-]?key)\s*[:=]\s*)[^\s]+/gi, '[redacted]')
    .replace(/(?:sk-|gh[pousr]_|doppler_)[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(-350)
  return new Error(detail ? `${base}: ${detail}` : base)
}
