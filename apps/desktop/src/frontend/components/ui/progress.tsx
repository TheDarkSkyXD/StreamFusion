import * as ProgressPrimitive from "@radix-ui/react-progress";
import * as React from "react";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { indeterminate?: boolean }
>(({ className, value, indeterminate = false, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    value={indeterminate ? null : value}
    className={cn(
      "relative h-4 w-full overflow-hidden rounded-full bg-[var(--color-background-tertiary)]",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        "h-full bg-[var(--color-primary)]",
        indeterminate
          ? "w-1/3 animate-download-progress motion-reduce:animate-none"
          : "w-full transition-transform duration-300 ease-linear motion-reduce:transition-none"
      )}
      style={indeterminate ? undefined : { transform: `translateX(-${100 - (value ?? 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
