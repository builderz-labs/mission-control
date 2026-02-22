'use client'

import { useState, useEffect } from 'react'

export function DigitalClock() {
  const [time, setTime] = useState<string>('')

  useEffect(() => {
    const update = () => {
      setTime(new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      }))
    }
    update()
    const timer = setInterval(update, 10_000)
    return () => clearInterval(timer)
  }, [])

  if (!time) return null

  return (
    <span className="text-xs text-muted-foreground digital-clock">
      {time}
    </span>
  )
}
