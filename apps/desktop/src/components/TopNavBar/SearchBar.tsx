import { useNavigate } from "@tanstack/react-router";
import { memo, useCallback } from "react";

import { UnifiedSearchInput } from "@/components/search/UnifiedSearchInput";

interface SearchBarProps {
  className?: string;
}

export const SearchBar = memo(function SearchBar({ className }: SearchBarProps) {
  const navigate = useNavigate();
  const handleSearch = useCallback(
    (term: string) => {
      navigate({ to: "/search", search: { q: term } });
    },
    [navigate]
  );

  return (
    <UnifiedSearchInput
      className={className}
      onSearch={handleSearch}
      placeholder="Search streams, channels, categories..."
    />
  );
});
