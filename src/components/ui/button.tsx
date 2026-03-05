"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 px-3",
        icon: "size-8",
        "icon-lg": "size-9",
        "icon-sm": "size-7",
        "icon-xl": "size-10 [&_svg]:size-5",
        "icon-xs": "size-6 rounded-md [&_svg]:size-3.5",
        lg: "h-9 px-3.5",
        sm: "h-7 gap-1.5 px-2.5 text-xs",
        xl: "h-10 px-4 text-base [&_svg]:size-5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg]:size-3.5",
      },
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/80",
        destructive:
          "border-destructive bg-destructive text-white shadow-sm hover:bg-destructive/90 active:bg-destructive/80",
        "destructive-outline":
          "border-input bg-popover text-red-400 shadow-sm hover:border-red-500/30 hover:bg-red-500/10 active:bg-red-500/15",
        ghost:
          "border-transparent text-foreground hover:bg-accent active:bg-accent/80",
        link: "border-transparent underline-offset-4 hover:underline",
        outline:
          "border-input bg-popover text-foreground shadow-sm hover:bg-accent/50 active:bg-accent/70",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/90 active:bg-secondary/80",
      },
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ className, size, variant }))}
        ref={ref}
        type={type}
        data-slot="button"
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
