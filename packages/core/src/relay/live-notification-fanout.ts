import type {
  LiveNotificationPair,
  NotificationChannelId,
} from "./live-notifications.ts";

export const MAX_FCM_TOPIC_SUBSCRIPTIONS = 2_000;
export const LIVE_NOTIFICATION_TOPIC_PREFIX = "sf.live";

export type FanoutRecipient = {
  readonly tokenFingerprint: string;
  readonly topicNames: readonly string[];
  readonly overflowKeys: readonly string[];
};

export type PlannedTopicSend = {
  readonly mode: "topic";
  readonly eventId: string;
  readonly topic: string;
  readonly fingerprints: readonly string[];
};

export type PlannedDirectSend = {
  readonly mode: "direct";
  readonly eventId: string;
  readonly fingerprints: readonly string[];
};

export type PlannedNotificationSend = PlannedDirectSend | PlannedTopicSend;

export type InstallationFanoutPlan = {
  readonly topicNames: readonly string[];
  readonly overflowPairs: readonly LiveNotificationPair[];
};

export function liveNotificationTopicName(pair: LiveNotificationPair): string {
  const channel = pair.channelId.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, 180);
  return `${LIVE_NOTIFICATION_TOPIC_PREFIX}.${pair.platform}.${channel}`;
}

export function liveNotificationPairKey(pair: LiveNotificationPair): string {
  return `${pair.platform}:${pair.channelId}`;
}

export function planInstallationFanout(
  pairs: readonly LiveNotificationPair[],
): InstallationFanoutPlan {
  return {
    topicNames: pairs
      .slice(0, MAX_FCM_TOPIC_SUBSCRIPTIONS)
      .map(liveNotificationTopicName),
    overflowPairs: pairs.slice(MAX_FCM_TOPIC_SUBSCRIPTIONS),
  };
}

export function planLogicalEventDelivery(input: {
  readonly eventId: string;
  readonly channel: NotificationChannelId;
  readonly pair: LiveNotificationPair | null;
  readonly recipients: readonly FanoutRecipient[];
}): readonly PlannedNotificationSend[] {
  if (input.channel !== "live" || input.pair === null) {
    return directPlan(input.eventId, fingerprintsOf(input.recipients));
  }
  const topic = liveNotificationTopicName(input.pair);
  const classified = classifyLiveRecipients(
    input.recipients,
    topic,
    liveNotificationPairKey(input.pair),
  );
  if (classified.topicFingerprints.length === 0) {
    return directPlan(input.eventId, classified.overflowFingerprints);
  }
  return liveSends(input.eventId, topic, classified);
}

export function countPlannedRecipients(
  sends: readonly PlannedNotificationSend[],
): number {
  const seen = new Set<string>();
  for (const send of sends) {
    for (const fingerprint of send.fingerprints) {
      seen.add(fingerprint);
    }
  }
  return seen.size;
}

function directPlan(
  eventId: string,
  fingerprints: readonly string[],
): readonly PlannedNotificationSend[] {
  if (fingerprints.length === 0) return [];
  return [{ mode: "direct", eventId, fingerprints }];
}

function liveSends(
  eventId: string,
  topic: string,
  classified: {
    readonly topicFingerprints: readonly string[];
    readonly overflowFingerprints: readonly string[];
  },
): readonly PlannedNotificationSend[] {
  const sends: PlannedNotificationSend[] = [
    {
      mode: "topic",
      eventId,
      topic,
      fingerprints: classified.topicFingerprints,
    },
  ];
  if (classified.overflowFingerprints.length > 0) {
    sends.push({
      mode: "direct",
      eventId,
      fingerprints: classified.overflowFingerprints,
    });
  }
  return sends;
}

function classifyLiveRecipients(
  recipients: readonly FanoutRecipient[],
  topic: string,
  pairKey: string,
): {
  readonly topicFingerprints: readonly string[];
  readonly overflowFingerprints: readonly string[];
} {
  const topicFingerprints: string[] = [];
  const overflowFingerprints: string[] = [];
  const seen = new Set<string>();
  for (const recipient of recipients) {
    if (seen.has(recipient.tokenFingerprint)) continue;
    seen.add(recipient.tokenFingerprint);
    if (recipient.topicNames.includes(topic)) {
      topicFingerprints.push(recipient.tokenFingerprint);
      continue;
    }
    if (recipient.overflowKeys.includes(pairKey)) {
      overflowFingerprints.push(recipient.tokenFingerprint);
    }
  }
  return { topicFingerprints, overflowFingerprints };
}

function fingerprintsOf(recipients: readonly FanoutRecipient[]): string[] {
  const seen = new Set<string>();
  const fingerprints: string[] = [];
  for (const recipient of recipients) {
    if (seen.has(recipient.tokenFingerprint)) continue;
    seen.add(recipient.tokenFingerprint);
    fingerprints.push(recipient.tokenFingerprint);
  }
  return fingerprints;
}
