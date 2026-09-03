import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useAuthStore } from "@/store/auth-store";
import { getDisplayLanguage, resolveDisplayLanguage } from "@shared/display-language";

import { activateDisplayLanguage } from ".";

export function DisplayLanguageSync({ children }: { children?: ReactNode }) {
  const preferences = useAuthStore((state) => state.preferences);
  const initialized = useAuthStore((state) => state.initialized);
  const { i18n } = useTranslation();
  const language = resolveDisplayLanguage(preferences?.language);
  const [appliedLanguage, setAppliedLanguage] = useState(i18n.resolvedLanguage);

  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    const applyLanguage = async () => {
      try {
        await activateDisplayLanguage(language);
        if (cancelled) return;
        const definition = getDisplayLanguage(language);
        document.documentElement.lang = language;
        document.documentElement.dir = definition.direction;
        setAppliedLanguage(language);
      } catch {
        if (!cancelled) setAppliedLanguage(undefined);
      }
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
