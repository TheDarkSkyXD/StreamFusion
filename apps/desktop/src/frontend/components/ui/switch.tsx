import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & { thumbClassName?: string }
>(({ className, thumbClassName, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "sf-switch peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-[12px] border-2 p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#efeff1] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
    ref={ref}
  >
    <svg aria-hidden className="sf-switch-check" viewBox="0 0 16 16">
      <path d="m13 6-6 6-4-4 1.5-1.5L7 9l4.5-4.5L13 6Z" />
    </svg>
    <SwitchPrimitive.Thumb
      className={cn(
        "sf-switch-thumb pointer-events-none block h-[14px] w-[14px] translate-x-[2px] rounded-full bg-white ring-0 transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[2px]",
        thumbClassName
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
