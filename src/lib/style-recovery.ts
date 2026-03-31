export const STYLE_RECOVERY_FLAG = 'mc-style-recovery-v1'
export const STYLE_RECOVERY_PARAM = 'mc_r'

export function shouldAttemptStyleRecovery(state: {
  sentinelHeight: number
  hasRecoveryFlag: boolean
}): boolean {
  return state.sentinelHeight < 4 && !state.hasRecoveryFlag
}

export function buildStyleRecoveryScript(): string {
  return `(function(){try{var flag='${STYLE_RECOVERY_FLAG}';var param='${STYLE_RECOVERY_PARAM}';var root=document.documentElement;if(!root||!document.body)return;var sentinel=document.createElement('div');sentinel.setAttribute('aria-hidden','true');sentinel.className='fixed left-0 top-0 h-4 w-4 bg-background opacity-0 pointer-events-none';document.body.appendChild(sentinel);var height=sentinel.getBoundingClientRect().height;sentinel.remove();if(height>=4)return;if(sessionStorage.getItem(flag)==='1')return;sessionStorage.setItem(flag,'1');var url=new URL(window.location.href);url.searchParams.set(param,Date.now().toString());window.location.replace(url.toString())}catch(_err){}})();`
}
