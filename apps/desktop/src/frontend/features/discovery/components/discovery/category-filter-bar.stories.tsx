import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { CategoryFilterBar } from "./category-filter-bar";

const meta = {
  title: "Components/Discovery/CategoryFilterBar",
  component: CategoryFilterBar,
  args: {
    language: "",
    onLanguageChange: () => undefined,
    tagQuery: "",
    onTagQueryChange: () => undefined,
    sortOrder: "desc",
    onSortOrderChange: () => undefined,
  },
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Responsive filter controls shared by category stream and clip views. Its controls remain usable as the toolbar wraps at narrow widths.",
      },
    },
  },
} satisfies Meta<typeof CategoryFilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

function StreamFilters() {
  const [language, setLanguage] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  return (
    <CategoryFilterBar
      language={language}
      onLanguageChange={setLanguage}
      tagQuery={tagQuery}
      onTagQueryChange={setTagQuery}
      sortOrder={sortOrder}
      onSortOrderChange={setSortOrder}
    />
  );
}

export const StreamSorting: Story = {
  render: () => <StreamFilters />,
};

export const NarrowToolbar: Story = {
  render: () => (
    <div className="max-w-[430px] rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4">
      <StreamFilters />
    </div>
  ),
};
