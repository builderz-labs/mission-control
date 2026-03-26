'use client'

import { useState, useRef, useCallback } from 'react'

interface HaltButtonProps {
  onHalted?: (count: number) => void
  className?: string
}

type ButtonState = 'default' | 'confirming' | 'halting' | 'success'

export function HaltButton({ onHalted, className = '' }: HaltButtonProps) {
  const [buttonState, setButtonState] = useState<ButtonState>('default')
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearConfirmTimer = () => {
    if (confirmTimerRef.current !== null) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
  }

  const handleHalt = useCallback(async () => {
    try {
      setButtonState('halting')
      const res = await fetch('/api/agents/halt', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        // Revert to default on API error
        setButtonState('default')
        return
      }

      setButtonState('success')
      onHalted?.(data.halted_count ?? 0)

      // Flash green for 1.5 s, then revert
      setTimeout(() => {
        setButtonState('default')
      }, 1500)
    } catch {
      setButtonState('default')
    }
  }, [onHalted])

  const handleClick = () => {
    if (buttonState === 'halting') return

    if (buttonState === 'success') return

    if (buttonState === 'default') {
      // Enter confirmation state
      setButtonState('confirming')
      confirmTimerRef.current = setTimeout(() => {
        setButtonState('default')
        confirmTimerRef.current = null
      }, 3000)
      return
    }

    if (buttonState === 'confirming') {
      clearConfirmTimer()
      handleHalt()
    }
  }

  const isDisabled = buttonState === 'halting'

  let label = 'HALT ALL'
  if (buttonState === 'confirming') label = 'CONFIRM HALT'
  if (buttonState === 'halting') label = 'HALTING...'

  const baseClasses =
    'inline-flex items-center justify-center px-3 py-1.5 rounded-[4px] font-mono text-xs uppercase tracking-wide transition-colors duration-150 border focus:outline-none'

  let stateClasses = ''
  if (buttonState === 'success') {
    stateClasses = 'border-[#22c55e] text-[#22c55e] bg-transparent cursor-default'
  } else if (buttonState === 'halting') {
    stateClasses =
      'border-[#ef4444]/50 text-[#ef4444] bg-transparent opacity-50 cursor-not-allowed'
  } else if (buttonState === 'confirming') {
    stateClasses =
      'border-[#ef4444] text-[#ef4444] bg-[#ef4444]/10 animate-pulse cursor-pointer'
  } else {
    stateClasses =
      'border-[#ef4444]/50 text-[#ef4444] bg-transparent hover:border-[#ef4444] hover:bg-[#ef4444]/10 cursor-pointer'
  }

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={handleClick}
      className={`${baseClasses} ${stateClasses} ${className}`}
    >
      {label}
    </button>
  )
}

export default HaltButton
