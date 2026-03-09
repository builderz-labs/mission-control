'use client'

import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useEffect } from 'react'
import { cn } from '@/lib/utils'

interface AnimatedModalProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
}

export function AnimatedModal({ open, onClose, children, className }: AnimatedModalProps) {
  const prefersReduced = useReducedMotion()
  const duration = prefersReduced ? 0 : 0.2

  // Escape key handler
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration * 0.75 }}
            onClick={onClose}
          />
          {/* Panel */}
          <motion.div
            className={cn('relative z-10', className)}
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
