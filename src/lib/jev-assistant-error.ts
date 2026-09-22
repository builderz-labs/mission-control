export class JevAssistantProviderError extends Error {
  constructor(readonly code: string, readonly status: 429 | 502 | 503 | 504) {
    super(code)
    this.name = 'JevAssistantProviderError'
  }
}

export function jevAssistantErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    JEV_ASSISTANT_UNAVAILABLE: 'This setup assistant is not connected. Choose another configured assistant or ask an administrator to connect it.',
    JEV_ASSISTANT_AUTH: 'The setup provider rejected its API key. Check the selected provider’s key in Doppler, then restart the backend.',
    JEV_ASSISTANT_TIMEOUT: 'The setup assistant took too long. Your saved conversation is safe; try again or choose another provider.',
    JEV_ASSISTANT_RATE_LIMITED: 'The setup provider is busy or its usage limit was reached. Wait a moment and try again.',
    JEV_ASSISTANT_REFUSED: 'The setup assistant could not help with that request. Try describing the evidence and the specific decision you need.',
    JEV_ASSISTANT_INVALID_OUTPUT: 'The assistant returned an incomplete or invalid setup. Nothing was applied; please try again.',
    JEV_ASSISTANT_CANCELLED: 'Setup generation was cancelled. Nothing was applied.',
    JEV_ASSISTANT_PROVIDER_ERROR: 'The setup provider could not complete this request. Check its model access and try again.',
  }
  return messages[code] ?? 'The assistant could not return a safe setup. Nothing was applied; please try again.'
}
