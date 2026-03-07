'use client'

import { type ComponentPropsWithoutRef, type ReactElement } from 'react'
import { cn } from '@/lib/utils'

const variantStyles = {
  default: 'bg-primary/15 text-primary border-primary/20',
  secondary: 'bg-surface-1 text-muted-foreground border-border',
  outline: 'bg-transparent text-foreground border-border',
  destructive: 'bg-red-500/15 text-red-400 border-red-500/20',
  error: 'bg-red-500/15 text-red-400 border-red-500/20',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
} as const

const sizeStyles = {
  sm: 'text-[10px] px-1.5 py-0 h-4 gap-0.5 [&_svg]:size-2.5',
  default: 'text-[11px] px-2 py-0.5 h-5 gap-1 [&_svg]:size-3',
  lg: 'text-xs px-2.5 py-1 h-6 gap-1.5 [&_svg]:size-3.5',
} as const

type BadgeVariant = keyof typeof variantStyles
type BadgeSize = keyof typeof sizeStyles

interface BadgeProps extends ComponentPropsWithoutRef<'span'> {
  variant?: BadgeVariant
  size?: BadgeSize
  render?: ReactElement
}

export function Badge({
  variant = 'secondary',
  size = 'default',
  className,
  render,
  children,
  ...props
}: BadgeProps) {
  const classes = cn(
    'inline-flex items-center rounded-md border font-medium whitespace-nowrap transition-colors',
    variantStyles[variant],
    sizeStyles[size],
    className
  )

  if (render) {
    // Clone the render element with badge styling
    const { props: renderProps, ...rest } = render as any
    return {
      ...rest,
      props: {
        ...renderProps,
        className: cn(classes, renderProps?.className),
        children: children ?? renderProps?.children,
        ...props,
      },
    } as ReactElement
  }

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  )
}
