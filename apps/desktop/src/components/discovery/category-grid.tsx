import type { UnifiedCategory } from "@/backend/api/unified/platform-types";
import { cn } from "@/lib/utils";

import { CategoryCard } from "./category-card";
import { CategoryCardSkeleton } from "./category-card-skeleton";

interface CategoryGridProps {
  categories?: UnifiedCategory[];
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  skeletons?: number;
  imageLoading?: "lazy" | "eager";
}

export function CategoryGrid({
  categories,
  isLoading = false,
  emptyMessage = "No categories found",
  className,
  skeletons = 12,
  imageLoading = "lazy",
}: CategoryGridProps) {
  if (isLoading) {
    return (
      <div className={cn("grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4", className)}>
        {Array.from({ length: skeletons }).map((_, i) => (
          <CategoryCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!categories || categories.length === 0) {
    return (
      <div className="col-span-full py-12 text-center text-[var(--color-foreground-muted)] animate-fade-in-up">
        <div className="text-4xl mb-4">🎮</div>
        <p className="text-lg">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4",
        "stagger-scale-container", // CSS-based scale stagger animation
        className
      )}
    >
      {categories.map((category) => (
        <CategoryCard
          key={`${category.platform}-${category.id}`}
          category={category}
          imageLoading={imageLoading}
        />
      ))}
    </div>
  );
}
