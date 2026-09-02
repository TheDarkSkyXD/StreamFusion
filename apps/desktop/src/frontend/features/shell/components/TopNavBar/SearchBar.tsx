import { useNavigate } from "@tanstack/react-router";
import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { UnifiedSearchInput } from "@/features/discovery/components/search/UnifiedSearchInput";

interface SearchBarProps {
  className?: string;
}

export const SearchBar = memo(function SearchBar({ className }: SearchBarProps) {
  const { t } = useTranslation();
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
      inputClassName="!bg-[#191919] placeholder:!text-white/30"
      onSearch={handleSearch}
      placeholder={t("discovery.search.placeholder")}
    />
  );
});
