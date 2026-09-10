/** SQLite expression that prefers token_usage.agent_name, then session_id prefix. */
export const TOKEN_AGENT_KEY_SQL = `COALESCE(NULLIF(agent_name, ''), CASE WHEN INSTR(session_id, ':') > 0 THEN SUBSTR(session_id, 1, INSTR(session_id, ':') - 1) ELSE session_id END)`
