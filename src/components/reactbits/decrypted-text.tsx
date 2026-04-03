'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'

interface DecryptedTextProps {
  readonly text: string
  readonly speed?: number
  readonly maxIterations?: number
  readonly sequential?: boolean
  readonly revealDirection?: 'start' | 'end' | 'center'
  readonly characters?: string
  readonly className?: string
  readonly encryptedClassName?: string
  readonly parentClassName?: string
  readonly animateOn?: 'view' | 'hover'
}

export default function DecryptedText({
  text,
  speed = 50,
  maxIterations = 10,
  sequential = false,
  revealDirection = 'start',
  characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+',
  className = '',
  parentClassName = '',
  encryptedClassName = '',
  animateOn = 'view',
}: DecryptedTextProps) {
  const [displayText, setDisplayText] = useState<string>(text)
  const [isAnimating, setIsAnimating] = useState<boolean>(false)
  const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set())
  const [hasAnimated, setHasAnimated] = useState<boolean>(false)
  const [isDecrypted, setIsDecrypted] = useState<boolean>(false)
  const containerRef = useRef<HTMLSpanElement>(null)

  const availableChars = useMemo<readonly string[]>(() => {
    return characters.split('')
  }, [characters])

  const shuffleText = useCallback(
    (originalText: string, currentRevealed: Set<number>) => {
      return originalText
        .split('')
        .map((char, i) => {
          if (char === ' ') return ' '
          if (currentRevealed.has(i)) return originalText[i]
          return availableChars[Math.floor(Math.random() * availableChars.length)]
        })
        .join('')
    },
    [availableChars]
  )

  const triggerDecrypt = useCallback(() => {
    setRevealedIndices(new Set())
    setIsAnimating(true)
  }, [])

  useEffect(() => {
    if (!isAnimating) return

    let currentIteration = 0

    const getNextIndex = (revealedSet: Set<number>): number => {
      const textLength = text.length
      switch (revealDirection) {
        case 'start':
          return revealedSet.size
        case 'end':
          return textLength - 1 - revealedSet.size
        case 'center': {
          const middle = Math.floor(textLength / 2)
          const offset = Math.floor(revealedSet.size / 2)
          const nextIndex = revealedSet.size % 2 === 0 ? middle + offset : middle - offset - 1
          if (nextIndex >= 0 && nextIndex < textLength && !revealedSet.has(nextIndex)) {
            return nextIndex
          }
          for (let i = 0; i < textLength; i++) {
            if (!revealedSet.has(i)) return i
          }
          return 0
        }
        default:
          return revealedSet.size
      }
    }

    const interval = setInterval(() => {
      setRevealedIndices(prevRevealed => {
        if (sequential) {
          if (prevRevealed.size < text.length) {
            const nextIndex = getNextIndex(prevRevealed)
            const newRevealed = new Set(prevRevealed)
            newRevealed.add(nextIndex)
            setDisplayText(shuffleText(text, newRevealed))
            return newRevealed
          } else {
            clearInterval(interval)
            setIsAnimating(false)
            setIsDecrypted(true)
            return prevRevealed
          }
        } else {
          setDisplayText(shuffleText(text, prevRevealed))
          currentIteration++
          if (currentIteration >= maxIterations) {
            clearInterval(interval)
            setIsAnimating(false)
            setDisplayText(text)
            setIsDecrypted(true)
          }
          return prevRevealed
        }
      })
    }, speed)
    return () => clearInterval(interval)
  }, [isAnimating, text, speed, maxIterations, sequential, revealDirection, shuffleText])

  // Hover behavior
  const triggerHoverDecrypt = useCallback(() => {
    if (isAnimating) return
    setRevealedIndices(new Set())
    setIsDecrypted(false)
    setDisplayText(text)
    setIsAnimating(true)
  }, [isAnimating, text])

  const resetToPlainText = useCallback(() => {
    setIsAnimating(false)
    setRevealedIndices(new Set())
    setDisplayText(text)
    setIsDecrypted(true)
  }, [text])

  // View observer
  useEffect(() => {
    if (animateOn !== 'view') return

    const observerCallback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !hasAnimated) {
          triggerDecrypt()
          setHasAnimated(true)
        }
      })
    }

    const observer = new IntersectionObserver(observerCallback, {
      root: null,
      rootMargin: '0px',
      threshold: 0.1,
    })
    const currentRef = containerRef.current
    if (currentRef) observer.observe(currentRef)

    return () => {
      if (currentRef) observer.unobserve(currentRef)
    }
  }, [animateOn, hasAnimated, triggerDecrypt])

  useEffect(() => {
    setDisplayText(text)
    setIsDecrypted(animateOn !== 'view')
    setRevealedIndices(new Set())
  }, [animateOn, text])

  const hoverProps =
    animateOn === 'hover'
      ? { onMouseEnter: triggerHoverDecrypt, onMouseLeave: resetToPlainText }
      : {}

  return (
    <span
      ref={containerRef}
      className={`inline-block whitespace-pre-wrap ${parentClassName}`}
      {...hoverProps}
    >
      <span className="sr-only">{displayText}</span>
      <span aria-hidden="true">
        {displayText.split('').map((char, index) => {
          const isRevealedOrDone = revealedIndices.has(index) || (!isAnimating && isDecrypted)
          return (
            <span key={index} className={isRevealedOrDone ? className : encryptedClassName}>
              {char}
            </span>
          )
        })}
      </span>
    </span>
  )
}
