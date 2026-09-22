import { useEffect, useState, type ReactNode } from "react";
import { I18nManager, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  DEFAULT_DISPLAY_LANGUAGE,
  getDisplayLanguage,
  resolveDisplayLanguage,
  type DisplayLanguage,
} from "@streamfusion/core/display-language";

import { activateDisplayLanguage } from ".";

export function DisplayLanguageSync({
  children,
  language,
  ready = true,
}: {
  readonly children?: ReactNode;
  readonly language: string | undefined;
  readonly ready?: boolean;
}) {
  const { i18n } = useTranslation();
  const resolved = resolveDisplayLanguage(language);
  const [settledLanguage, setSettledLanguage] = useState<string | undefined>(
    i18n.resolvedLanguage,
  );

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const applyLanguage = async () => {
      try {
        await activateDisplayLanguage(resolved);
        if (cancelled) return;
        applyDocumentDirection(resolved);
        setSettledLanguage(resolved);
      } catch {
        await activateDisplayLanguage(DEFAULT_DISPLAY_LANGUAGE);
        if (cancelled) return;
        applyDocumentDirection(DEFAULT_DISPLAY_LANGUAGE);
        setSettledLanguage(resolved);
      }
    };
    void applyLanguage();
    return () => {
      cancelled = true;
    };
  }, [i18n, ready, resolved]);

  if (!ready || settledLanguage !== resolved) {
    return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
  }

  return children;
}

function applyDocumentDirection(language: DisplayLanguage): void {
  const definition = getDisplayLanguage(language);
  const wantRtl = definition.direction === "rtl";
  if (I18nManager.isRTL !== wantRtl) {
    I18nManager.allowRTL(wantRtl);
    I18nManager.forceRTL(wantRtl);
  }
}
