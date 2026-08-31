import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

export default function DevelopmentClientScreen() {
  return (
    <View style={styles.screen} testID="development-client-ready">
      <Text accessibilityRole="header" style={styles.title}>
        StreamFusion Mobile
      </Text>
      <Text style={styles.status}>Android development client is ready.</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: "#0f0f0f",
    flex: 1,
    gap: 8,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 29,
  },
  status: {
    color: "#a0a0a0",
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
    textAlign: "center",
  },
});
