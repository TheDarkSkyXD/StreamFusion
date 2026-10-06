import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AppState, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileProgress } from "@mobile/design/feedback";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileTextField } from "@mobile/design/text-input";
import { mobileColors, mobileSpacing, mobileType } from "@mobile/design/tokens";
import type { ModerationChannel } from "@mobile/features/moderation/capabilities/moderation";
import { WorkflowFeedback } from "@mobile/features/moderation/components/workflow-feedback";
import type { EngagementCommand } from "../capabilities/engagement";
import type {
  EngagementController,
  EngagementSnapshot,
} from "../domain/engagement-controller";

type EngagementSheetProps = {
  readonly channel: ModerationChannel;
  readonly controller: EngagementController;
  readonly visible: boolean;
  readonly initialTool?: "poll" | "prediction";
  readonly onDismiss: () => void;
  readonly onOpenProvider: (channel: ModerationChannel) => void;
  readonly onRequestScopes: (
    platform: Platform,
    scopes: readonly string[],
  ) => void;
};
export function EngagementSheet(props: EngagementSheetProps) {
  const { channel, controller, visible } = props;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") controller.cancel();
    });
    return () => listener.remove();
  }, [controller]);
  useEffect(() => {
    if (visible)
      void controller.open({
        id: channel.id,
        platform: channel.platform,
        login: channel.login,
        name: channel.name,
      });
    return () => controller.cancel();
  }, [
    controller,
    visible,
    channel.id,
    channel.platform,
    channel.login,
    channel.name,
  ]);
  return (
    <EngagementSheetBody
      key={`${channel.platform}:${channel.id}:${snapshot.sessionRevision}`}
      {...props}
      snapshot={snapshot}
    />
  );
}
function EngagementSheetBody({
  channel,
  controller,
  visible,
  onDismiss,
  onOpenProvider,
  onRequestScopes,
  snapshot,
  initialTool = "poll",
}: EngagementSheetProps & { readonly snapshot: EngagementSnapshot }) {
  const { t } = useTranslation();
  const [selectedTool, setSelectedTool] = useState(initialTool);
  const [form, setForm] = useState<"poll" | "prediction" | null>(null);
  const [confirmation, setConfirmation] = useState<{
    readonly title: string;
    readonly detail: string;
    readonly command: EngagementCommand;
    readonly revision: number;
  } | null>(null);
  const matches =
    snapshot.channel?.id === channel.id &&
    snapshot.channel.platform === channel.platform;
  const pending = snapshot.activity.kind === "pending";
  const owner = matches && snapshot.authority === "broadcaster";
  function review(title: string, detail: string, command: EngagementCommand) {
    setConfirmation({
      title,
      detail,
      command,
      revision: snapshot.sessionRevision,
    });
  }
  const validConfirmation =
    confirmation && confirmation.revision === snapshot.sessionRevision && owner
      ? confirmation
      : null;
  function dismiss() {
    setConfirmation(null);
    controller.cancel();
    onDismiss();
  }
  return (
    <>
      <MobileBottomSheet
        visible={visible}
        title={t("moderation.activeEngagement", {
          defaultValue: "Active engagement",
        })}
        size="expanded"
        onDismiss={dismiss}
      >
        <Text style={mobileType.label}>
          {channel.name} · {channel.platform === "twitch" ? "Twitch" : "Kick"}
        </Text>
        {matches ? (
          <WorkflowFeedback
            activity={snapshot.activity}
            onCancel={controller.cancel}
            onRequestScopes={(scopes) =>
              onRequestScopes(channel.platform, scopes)
            }
          />
        ) : null}
        <View style={styles.row}>
          {(["poll", "prediction"] as const).map((tool) => (
            <MobileFilterChip
              key={tool}
              accessibilityLabel={`Show ${tool}s`}
              label={t(
                `moderation.tools.${tool === "poll" ? "polls" : "predictions"}`,
                { defaultValue: tool === "poll" ? "Polls" : "Predictions" },
              )}
              selected={selectedTool === tool}
              onPress={() => {
                setSelectedTool(tool);
                setForm(null);
              }}
              testID={`engagement-tab-${tool}`}
            />
          ))}
        </View>
        {!owner && !pending ? (
          <Text style={mobileType.body}>
            {channel.platform === "kick"
              ? "Kick does not publish poll or prediction APIs. Open the channel on Kick to use its available engagement tools."
              : "Twitch requires the broadcaster account to read or manage polls and predictions through its API. Open Twitch to view a poll, vote, or spend Channel Points."}
          </Text>
        ) : null}
        {owner ? (
          <>
            <View style={styles.row}>
              <MobileButton
                accessibilityLabel="Create poll"
                disabled={
                  pending ||
                  snapshot.polls.some((poll) => poll.status === "ACTIVE")
                }
                onPress={() => {
                  setSelectedTool("poll");
                  setForm("poll");
                }}
                testID="engagement-create-poll"
                variant="secondary"
              >
                Create poll
              </MobileButton>
              <MobileButton
                accessibilityLabel="Create prediction"
                disabled={
                  pending ||
                  snapshot.predictions.some(
                    (prediction) =>
                      prediction.status === "ACTIVE" ||
                      prediction.status === "LOCKED",
                  )
                }
                onPress={() => {
                  setSelectedTool("prediction");
                  setForm("prediction");
                }}
                testID="engagement-create-prediction"
                variant="secondary"
              >
                Create prediction
              </MobileButton>
            </View>
            {form ? (
              <EngagementForm
                key={`${form}:${snapshot.sessionRevision}`}
                kind={form}
                pending={pending}
                onCancel={() => setForm(null)}
                onCreate={(command) => {
                  setForm(null);
                  review(
                    command.kind === "create-poll"
                      ? "Create poll"
                      : "Create prediction",
                    `Start "${command.title}" in ${channel.name} for ${command.durationSeconds} seconds?`,
                    command,
                  );
                }}
              />
            ) : null}
            {selectedTool === "poll" ? (
              <>
                <Text accessibilityRole="header" style={mobileType.title}>
                  Polls
                </Text>
                {snapshot.polls.length === 0 ? (
                  <Text style={mobileType.body}>No recent polls.</Text>
                ) : null}
                {snapshot.polls.map((poll) => (
                  <View key={poll.id} style={styles.card}>
                    <Text style={mobileType.title}>{poll.title}</Text>
                    <Text style={mobileType.label}>
                      {poll.status.toLowerCase()}
                    </Text>
                    {poll.choices.map((choice) => (
                      <View key={choice.id} style={styles.outcome}>
                        <Text style={mobileType.body}>
                          {choice.title}, {choice.votes} votes
                        </Text>
                        {poll.choices.reduce(
                          (sum, item) => sum + item.votes,
                          0,
                        ) > 0 ? (
                          <MobileProgress
                            label={`${choice.title} vote share`}
                            value={
                              choice.votes /
                              poll.choices.reduce(
                                (sum, item) => sum + item.votes,
                                0,
                              )
                            }
                          />
                        ) : null}
                      </View>
                    ))}
                    {poll.status === "ACTIVE" ? (
                      <View style={styles.row}>
                        <MobileButton
                          accessibilityLabel={`End poll ${poll.title}`}
                          disabled={pending}
                          onPress={() =>
                            review(
                              "End poll",
                              `End "${poll.title}" now? Results will remain visible.`,
                              { kind: "end-poll", id: poll.id, archive: false },
                            )
                          }
                          testID={`poll-end-${poll.id}`}
                          variant="outline"
                        >
                          {t("moderation.tools.actions.TERMINATED", {
                            defaultValue: "End poll",
                          })}
                        </MobileButton>
                        <MobileButton
                          accessibilityLabel={`Archive poll ${poll.title}`}
                          disabled={pending}
                          onPress={() =>
                            review(
                              "Archive poll",
                              `End and hide "${poll.title}" from the channel?`,
                              { kind: "end-poll", id: poll.id, archive: true },
                            )
                          }
                          testID={`poll-archive-${poll.id}`}
                          variant="destructive"
                        >
                          {t("moderation.tools.actions.ARCHIVED", {
                            defaultValue: "Archive poll",
                          })}
                        </MobileButton>
                      </View>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
            {selectedTool === "prediction" ? (
              <>
                <Text accessibilityRole="header" style={mobileType.title}>
                  Predictions
                </Text>
                {snapshot.predictions.length === 0 ? (
                  <Text style={mobileType.body}>No recent predictions.</Text>
                ) : null}
                {snapshot.predictions.map((prediction) => (
                  <View key={prediction.id} style={styles.card}>
                    <Text style={mobileType.title}>{prediction.title}</Text>
                    <Text style={mobileType.label}>
                      {prediction.status.toLowerCase()}
                    </Text>
                    {prediction.outcomes.map((outcome) => (
                      <View key={outcome.id} style={styles.outcome}>
                        <Text style={mobileType.body}>
                          {outcome.title} · {outcome.votes} participants
                          {outcome.id === prediction.winningOutcomeId
                            ? " · Winner"
                            : ""}
                        </Text>
                        {prediction.status === "ACTIVE" ||
                        prediction.status === "LOCKED" ? (
                          <MobileButton
                            accessibilityLabel={`Resolve prediction with ${outcome.title} as winner`}
                            disabled={pending}
                            onPress={() =>
                              review(
                                "Resolve prediction",
                                `Select "${outcome.title}" as the winner of "${prediction.title}"? Twitch will distribute Channel Points. This cannot be changed afterward.`,
                                {
                                  kind: "resolve-prediction",
                                  id: prediction.id,
                                  winningOutcomeId: outcome.id,
                                },
                              )
                            }
                            testID={`prediction-resolve-${outcome.id}`}
                            variant="outline"
                          >
                            {t("moderation.tools.chooseWinner", {
                              defaultValue: "Choose winner",
                            })}
                          </MobileButton>
                        ) : null}
                      </View>
                    ))}
                    {prediction.status === "ACTIVE" ? (
                      <MobileButton
                        accessibilityLabel={`Lock prediction ${prediction.title}`}
                        disabled={pending}
                        onPress={() =>
                          review(
                            "Lock prediction",
                            `Stop new predictions for "${prediction.title}"?`,
                            { kind: "lock-prediction", id: prediction.id },
                          )
                        }
                        testID={`prediction-lock-${prediction.id}`}
                        variant="secondary"
                      >
                        {t("moderation.tools.actions.LOCKED", {
                          defaultValue: "Lock prediction",
                        })}
                      </MobileButton>
                    ) : null}
                    {prediction.status === "ACTIVE" ||
                    prediction.status === "LOCKED" ? (
                      <MobileButton
                        accessibilityLabel={`Cancel prediction ${prediction.title}`}
                        disabled={pending}
                        onPress={() =>
                          review(
                            "Cancel prediction",
                            `Cancel "${prediction.title}" and refund all participants' Channel Points?`,
                            { kind: "cancel-prediction", id: prediction.id },
                          )
                        }
                        testID={`prediction-cancel-${prediction.id}`}
                        variant="destructive"
                      >
                        Cancel and refund
                      </MobileButton>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}
        <MobileButton
          accessibilityLabel="Refresh polls and predictions"
          disabled={pending}
          onPress={() => void controller.refresh()}
          testID="engagement-refresh"
          variant="outline"
        >
          Refresh
        </MobileButton>
        <Text style={mobileType.body}>
          Voting and Channel Points wagers happen on the provider.
        </Text>
        <MobileButton
          accessibilityLabel={`Open ${channel.name} on ${channel.platform} for engagement`}
          onPress={() => onOpenProvider(channel)}
          testID="engagement-provider"
          variant="primary"
        >
          Open channel on provider
        </MobileButton>
      </MobileBottomSheet>
      <MobileDialog
        visible={visible && validConfirmation !== null}
        title={validConfirmation?.title ?? "Confirm action"}
        message={validConfirmation?.detail ?? ""}
        confirmLabel="Confirm action"
        destructive={
          validConfirmation?.command.kind === "resolve-prediction" ||
          validConfirmation?.command.kind === "cancel-prediction"
        }
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const command = validConfirmation?.command;
          setConfirmation(null);
          if (command) void controller.execute(command);
        }}
      />
    </>
  );
}
function EngagementForm({
  kind,
  pending,
  onCancel,
  onCreate,
}: {
  readonly kind: "poll" | "prediction";
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onCreate: (
    command: Extract<
      EngagementCommand,
      { kind: "create-poll" | "create-prediction" }
    >,
  ) => void;
}) {
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [duration, setDuration] = useState("120");
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={mobileType.title}>
        {kind === "poll" ? "New poll" : "New prediction"}
      </Text>
      <MobileTextField
        label="Question"
        hint={`Up to ${kind === "poll" ? 60 : 45} characters.`}
        value={title}
        onChange={setTitle}
        disabled={pending}
      />
      {options.map((option, index) => (
        <MobileTextField
          key={index}
          label={`Choice ${index + 1}`}
          hint="Up to 25 characters."
          value={option}
          onChange={(value) =>
            setOptions(
              options.map((entry, position) =>
                position === index ? value : entry,
              ),
            )
          }
          disabled={pending}
        />
      ))}
      <View style={styles.row}>
        <MobileButton
          accessibilityLabel="Add another choice"
          disabled={pending || options.length >= (kind === "poll" ? 5 : 10)}
          onPress={() => setOptions([...options, ""])}
          testID="engagement-add-choice"
          variant="outline"
        >
          Add choice
        </MobileButton>
        <MobileButton
          accessibilityLabel="Remove last choice"
          disabled={pending || options.length <= 2}
          onPress={() => setOptions(options.slice(0, -1))}
          testID="engagement-remove-choice"
          variant="ghost"
        >
          Remove last
        </MobileButton>
      </View>
      <MobileTextField
        label="Duration in seconds"
        hint={`${kind === "poll" ? 15 : 30} to 1800 seconds.`}
        value={duration}
        onChange={setDuration}
        disabled={pending}
      />
      <MobileButton
        accessibilityLabel={`Review new ${kind}`}
        disabled={pending}
        onPress={() =>
          onCreate(
            kind === "poll"
              ? {
                  kind: "create-poll",
                  title,
                  choices: options,
                  durationSeconds: Number(duration),
                }
              : {
                  kind: "create-prediction",
                  title,
                  outcomes: options,
                  durationSeconds: Number(duration),
                },
          )
        }
        testID="engagement-submit"
        variant="primary"
      >
        Review and create
      </MobileButton>
      <MobileButton
        accessibilityLabel="Cancel creation"
        onPress={onCancel}
        testID="engagement-form-cancel"
        variant="ghost"
      >
        Cancel
      </MobileButton>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  card: {
    backgroundColor: mobileColors.surface,
    borderRadius: 12,
    padding: mobileSpacing.medium,
    gap: mobileSpacing.medium,
  },
  outcome: { gap: mobileSpacing.small },
});
