import { Text, View } from "react-native";
import { MobileButton } from "@mobile/design/button";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
import type { WorkflowActivity } from "../domain/moderation-controller";

export function WorkflowFeedback({
  activity,
  onCancel,
  onRequestScopes,
}: {
  readonly activity: WorkflowActivity;
  readonly onCancel: () => void;
  readonly onRequestScopes: (scopes: readonly string[]) => void;
}) {
  if (activity.kind === "idle") return null;
  return (
    <View style={{ gap: mobileSpacing.small }}>
      <Text accessibilityLiveRegion="polite" style={mobileType.body}>
        {activity.kind === "pending" ? `${activity.label}…` : activity.detail}
      </Text>
      {activity.kind === "pending" ? (
        <MobileButton
          accessibilityLabel="Stop waiting for request"
          onPress={onCancel}
          testID="workflow-cancel"
          variant="ghost"
        >
          Stop waiting
        </MobileButton>
      ) : null}
      {activity.kind === "failure" && activity.scopes.length > 0 ? (
        <MobileButton
          accessibilityLabel="Grant required permissions"
          onPress={() => onRequestScopes(activity.scopes)}
          testID="workflow-scopes"
          variant="primary"
        >
          Grant permissions
        </MobileButton>
      ) : null}
    </View>
  );
}
