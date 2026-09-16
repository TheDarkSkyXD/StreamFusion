import { StyleSheet, Text, View } from "react-native";

import { mobileColors, mobileRadii, mobileSpacing, mobileType } from "./tokens";

export function catalogTagLabels(input: {
  readonly language?: string;
  readonly tags?: readonly string[];
}): readonly string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const key = value.trim().toLowerCase();
    if (key === "" || seen.has(key)) return;
    seen.add(key);
    labels.push(value.trim());
  };
  if (input.language) push(input.language);
  for (const tag of input.tags ?? []) push(tag);
  return labels.slice(0, 4);
}

export function MobileTag({ label }: { readonly label: string }) {
  return (
    <View style={styles.tag}>
      <Text selectable style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

export function MobileCatalogTags({
  language,
  tags,
  testID,
}: {
  readonly language?: string;
  readonly tags?: readonly string[];
  readonly testID?: string;
}) {
  const labels = catalogTagLabels({
    ...(language === undefined ? {} : { language }),
    ...(tags === undefined ? {} : { tags }),
  });
  if (labels.length === 0) return null;
  return (
    <View
      {...(testID === undefined ? {} : { testID })}
      style={styles.row}
    >
      {labels.map((label) => (
        <MobileTag key={label} label={label} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  tag: {
    backgroundColor: mobileColors.tagSurface,
    borderRadius: mobileRadii.full,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  label: {
    ...mobileType.caption,
    color: mobileColors.tagText,
  },
});
