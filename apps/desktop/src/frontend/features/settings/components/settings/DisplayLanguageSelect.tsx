import { useTranslation } from "react-i18next";

import {
  DISPLAY_LANGUAGE_REGISTRY,
  resolveDisplayLanguage,
  type DisplayLanguage,
} from "@shared/display-language";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DisplayLanguageSelect({
  value,
  onChange,
  id = "display-language",
}: {
  value: DisplayLanguage;
  onChange: (language: DisplayLanguage) => void;
  id?: string;
}) {
  const { t } = useTranslation();
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => onChange(resolveDisplayLanguage(nextValue))}
    >
      <SelectTrigger id={id} aria-label={t("settings.displayLanguage")} className="min-w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent data-display-language-options>
        {DISPLAY_LANGUAGE_REGISTRY.map((language) => (
          <SelectItem key={language.code} value={language.code}>
            {language.nativeLabel === language.englishLabel
              ? language.nativeLabel
              : `${language.nativeLabel} (${language.englishLabel})`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
