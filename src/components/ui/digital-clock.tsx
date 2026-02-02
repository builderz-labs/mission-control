'use client'

import { useState, useEffect } from 'react'

export function DigitalClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    }).toUpperCase()
  }

  return (
    <div className="text-center">
      <div className="digital-clock text-2xl font-bold text-foreground tracking-wider">
        {formatTime(time)}
      </div>
      <div className="text-xs text-muted-foreground font-medium tracking-wide mt-1">
        {formatDate(time)}
      </div>
    </div>
  )
}