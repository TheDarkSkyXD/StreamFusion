import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useAuthStore } from "@/store/auth-store";

import { getDisplayLanguage, resolveDisplayLanguage } from ".";

export function DisplayLanguageSync({ children }: { children?: ReactNode }) {
  const preferences = useAuthStore((state) => state.preferences);
  const initialized = useAuthStore((state) => state.initialized);
  const { i18n } = useTranslation();
  const language = resolveDisplayLanguage(preferences?.language);
  const [appliedLanguage, setAppliedLanguage] = useState(i18n.resolvedLanguage);

  useEffect(() => {
    if (!initialized) return;
    const definition = getDisplayLanguage(language);
    document.documentElement.lang = language;
    document.documentElement.dir = definition.direction;
    let cancelled = false;
    const applyLanguage = async () => {
      if (i18n.resolvedLanguage !== language) await i18n.changeLanguage(language);
      if (!cancelled) setAppliedLanguage(language);
    };
    void applyLanguage();
    return () => {
      cancelled = true;
    };
  }, [i18n, initialized, language]);

  if (!initialized || appliedLanguage !== language) {
    return <div className="h-full bg-[var(--color-background)]" aria-hidden="true" />;
  }

  return children;
}
