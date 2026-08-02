import type React from "react";

import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse motion-reduce:animate-none rounded-md bg-[var(--color-background-elevated)]",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
