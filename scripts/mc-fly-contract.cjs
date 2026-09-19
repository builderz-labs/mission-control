function validateAdmission(value) {
  if (!value || !['fly','local','rejected'].includes(value.route) || typeof value.accepted !== 'boolean' || typeof value.safe_local_fallback !== 'boolean') {
    throw new Error('Mission Control returned no valid Fly admission; check server version and URL')
  }
  if (value.accepted && (value.route !== 'fly' || value.safe_local_fallback || !/^[a-f0-9]{32}$/.test(value.submission_id || '') || !Number.isInteger(value.task_id))) {
    throw new Error('Mission Control returned an inconsistent Fly admission')
  }
  if (value.safe_local_fallback && (value.accepted || value.route !== 'local')) throw new Error('Inconsistent fallback ownership')
  return value
}
function validateStatus(value) {
  if (!value || typeof value.ready !== 'boolean' || !Array.isArray(value.issues) || !Array.isArray(value.submissions) || value.transport !== 'polled') {
    throw new Error('Fly status API is unavailable or outdated; this is not proof of readiness')
  }
  return value
}
async function retryRead(read, sleep = ms => new Promise(resolve => setTimeout(resolve,ms))) {
  try { return await read() } catch { await sleep(500); return read() }
}
function validateCancellation(value) {
  if (!value || typeof value.released !== 'boolean' || value.safe_local_fallback !== value.released) {
    throw new Error('Cancellation unconfirmed; remote ownership retained')
  }
  return value
}
module.exports = { validateAdmission, validateStatus, validateCancellation, retryRead }
