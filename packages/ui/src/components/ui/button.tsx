import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { IconLoader2 } from "@tabler/icons-react"

import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all duration-[150ms] ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-primary-text)] disabled:pointer-events-none disabled:opacity-50 relative overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--ds-primary)] text-[var(--ds-on-primary)] rounded-[var(--ds-radius-md)] hover:opacity-90 active:scale-[0.98]",
        destructive:
          "bg-[var(--ds-tertiary-container)] text-[var(--ds-tertiary)] rounded-[var(--ds-radius-md)] hover:opacity-90 active:scale-[0.98]",
        outline:
          "bg-transparent text-[var(--ds-on-surface)] rounded-[var(--ds-radius-md)] hover:bg-[var(--ds-surface-container-low)]",
        secondary:
          "bg-[var(--ds-surface-container-highest)] text-[var(--ds-on-surface)] rounded-[var(--ds-radius-md)] hover:bg-[var(--ds-surface-container)] active:scale-[0.98]",
        ghost:
          "text-[var(--ds-primary-text)] bg-transparent rounded-[var(--ds-radius-md)] hover:bg-[var(--ds-surface-container-low)]",
        link:
          "text-[var(--ds-primary-text)] underline-offset-4 hover:underline bg-transparent",
        glow:
          "bg-gradient-to-br from-[var(--ds-primary)] to-[var(--ds-primary-container)] text-[var(--ds-on-primary)] rounded-[var(--ds-radius-md)] relative group shadow-[0_0_20px_rgba(208,188,255,0.3)] hover:shadow-[0_0_30px_rgba(208,188,255,0.5)] active:scale-[0.98]",
      },
      size: {
        default: "h-10 px-4 py-2",
        // Looks 32px, taps as 40px: the invisible ::after pads the hit area (min tap target) without changing the layout.
        sm: "relative h-8 px-3 text-xs rounded-[var(--ds-radius-sm)] after:absolute after:-inset-1 after:content-['']",
        lg: "h-11 px-8 rounded-[var(--ds-radius-md)]",
        icon: "h-10 w-10 rounded-[var(--ds-radius-md)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  isLoading?: boolean
  loadingText?: string
  withGlow?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, isLoading, loadingText, withGlow, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const isGlowVariant = variant === "glow" || withGlow

    const getLoadingText = () => {
      if (loadingText) return loadingText

      const childText = React.Children.toArray(children)
        .map(child => typeof child === 'string' ? child : '')
        .join(' ')
        .trim()

      if (!childText) return 'Loading...'

      const lowerText = childText.toLowerCase()

      if (lowerText.includes('add') && lowerText.includes('lead')) return 'Adding Lead...'
      if (lowerText.includes('add')) return 'Adding...'
      if (lowerText.includes('save')) return 'Saving...'
      if (lowerText.includes('create')) return 'Creating...'
      if (lowerText.includes('update')) return 'Updating...'
      if (lowerText.includes('delete')) return 'Deleting...'
      if (lowerText.includes('export')) return 'Exporting...'
      if (lowerText.includes('import')) return 'Importing...'
      if (lowerText.includes('send')) return 'Sending...'
      if (lowerText.includes('sync')) return 'Syncing...'
      if (lowerText.includes('convert')) return 'Converting...'
      if (lowerText.includes('schedule')) return 'Scheduling...'
      if (lowerText.includes('enrich')) return 'Enriching...'
      if (lowerText.includes('search')) return 'Searching...'
      if (lowerText.includes('generate')) return 'Generating...'
      if (lowerText.includes('copy')) return 'Copying...'

      return 'Loading...'
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
        // After the spread: disabled was destructured out of props, but spreading
        // last would still let any stray value win and let a loading button be
        // clicked twice.
        disabled={isLoading || disabled}
      >
        {asChild ? (
          children
        ) : (
          <>
            {isGlowVariant && (
              <div className="absolute inset-[-2px] rounded-[inherit] opacity-0 group-hover:opacity-100 transition-all duration-500 pointer-events-none">
                <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-[var(--ds-primary)]/30 to-[var(--ds-primary-container)]/30" />
                <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-br from-[var(--ds-primary)] to-[var(--ds-primary-container)] blur-xl opacity-20" />
              </div>
            )}
            {isLoading ? (
              (size === "icon" || loadingText === "") ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="inline-flex items-center gap-2">
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                  <span>{getLoadingText()}</span>
                </span>
              )
            ) : (
              children
            )}
          </>
        )}
      </Comp>
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
