import type { IpcRenderer } from "electron";

import {
  IPC_CHANNELS,
  IPC_FEATURES,
  type IpcChannel,
  type IpcFeature,
} from "../shared/ipc-channels";

function channelPrefix(channel: IpcChannel): string {
  return channel.slice(0, channel.indexOf(":") + 1);
}

const featureByPrefix = new Map<string, IpcFeature>([
  [channelPrefix(IPC_CHANNELS.ADBLOCK_GET_STATUS), IPC_FEATURES.ADBLOCK],
  [channelPrefix(IPC_CHANNELS.APP_GET_ENVIRONMENT), IPC_FEATURES.APP],
  [channelPrefix(IPC_CHANNELS.AUTH_GET_STATUS), IPC_FEATURES.AUTH],
  [channelPrefix(IPC_CHANNELS.BUG_REPORT_WRITE), IPC_FEATURES.BUG_REPORTS],
  [channelPrefix(IPC_CHANNELS.CATEGORIES_GET_TOP), IPC_FEATURES.CATEGORIES],
  [channelPrefix(IPC_CHANNELS.CHANNELS_GET_BY_ID), IPC_FEATURES.CHANNELS],
  [channelPrefix(IPC_CHANNELS.CHAT_GET_KICK_HISTORY), IPC_FEATURES.CHAT],
  [channelPrefix(IPC_CHANNELS.CLIPS_GET_BY_CHANNEL), IPC_FEATURES.VIDEOS],
  [channelPrefix(IPC_CHANNELS.CONNECTIVITY_CHECK), IPC_FEATURES.CONNECTIVITY],
  [channelPrefix(IPC_CHANNELS.DOWNLOADS_GET_QUEUE), IPC_FEATURES.DOWNLOADS],
  [channelPrefix(IPC_CHANNELS.EMOTES_7TV_GET_GLOBAL_EMOTE_SET), IPC_FEATURES.EMOTES],
  [channelPrefix(IPC_CHANNELS.FOLLOWS_GET_ALL), IPC_FEATURES.STORAGE],
  [channelPrefix(IPC_CHANNELS.KICK_CHAT_SEND_MESSAGE), IPC_FEATURES.KICK_CHAT],
  [channelPrefix(IPC_CHANNELS.LOCAL_CAPTIONS_MODEL_GET_STATE), IPC_FEATURES.LOCAL_CAPTIONS],
  [channelPrefix(IPC_CHANNELS.LOG_WRITE), IPC_FEATURES.LOGS],
  [channelPrefix(IPC_CHANNELS.LOGS_TAIL), IPC_FEATURES.LOGS],
  [channelPrefix(IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT), IPC_FEATURES.TIMEOUT_MODERATION],
  [channelPrefix(IPC_CHANNELS.MODLOG_QUERY), IPC_FEATURES.MOD_LOG],
  [channelPrefix(IPC_CHANNELS.PLATFORM_HEALTH_GET), IPC_FEATURES.PLATFORM_HEALTH],
  [channelPrefix(IPC_CHANNELS.PREFERENCES_GET), IPC_FEATURES.STORAGE],
  [channelPrefix(IPC_CHANNELS.PROXY_APPLY), IPC_FEATURES.PROXY],
  [channelPrefix(IPC_CHANNELS.RETENTION_GET), IPC_FEATURES.MOD_LOG],
  [channelPrefix(IPC_CHANNELS.SEARCH_ALL), IPC_FEATURES.SEARCH],
  [channelPrefix(IPC_CHANNELS.SLOT_CREATE), IPC_FEATURES.SLOTS],
  [channelPrefix(IPC_CHANNELS.STREAM_RECORDING_START), IPC_FEATURES.STREAM_RECORDING],
  [channelPrefix(IPC_CHANNELS.STREAMS_GET_TOP), IPC_FEATURES.STREAMS],
  [channelPrefix(IPC_CHANNELS.STORE_GET), IPC_FEATURES.STORAGE],
  [channelPrefix(IPC_CHANNELS.THEME_GET_SYSTEM), IPC_FEATURES.SYSTEM],
  [channelPrefix(IPC_CHANNELS.TWITCH_API_EXECUTE), IPC_FEATURES.TWITCH_API],
  [channelPrefix(IPC_CHANNELS.TWITCH_EVENTSUB_START), IPC_FEATURES.TWITCH_API],
  [channelPrefix(IPC_CHANNELS.UPDATE_CHECK), IPC_FEATURES.UPDATES],
  [channelPrefix(IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY), IPC_FEATURES.USER_PROFILE],
  [channelPrefix(IPC_CHANNELS.VIDEOS_GET_METADATA), IPC_FEATURES.VIDEOS],
  [channelPrefix(IPC_CHANNELS.WINDOW_MINIMIZE), IPC_FEATURES.SYSTEM],
]);

const playbackChannels = new Set<string>([
  IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL,
  IPC_CHANNELS.VIDEOS_GET_PLAYBACK_URL,
  IPC_CHANNELS.CLIPS_GET_PLAYBACK_URL,
]);

export function resolveIpcFeature(channel: string): IpcFeature | null {
  if (
    channel === IPC_CHANNELS.APP_GET_VERSION ||
    channel === IPC_CHANNELS.APP_GET_VERSION_INFO ||
    channel === IPC_CHANNELS.APP_GET_NAME ||
    channel === IPC_CHANNELS.NOTIFICATION_SHOW ||
    channel === IPC_CHANNELS.NOTIFICATION_COVERAGE_GET ||
    channel === IPC_CHANNELS.SHELL_OPEN_EXTERNAL
  ) {
    return IPC_FEATURES.SYSTEM;
  }
  if (channel === IPC_CHANNELS.AUTH_TOKEN_STATUS) return IPC_FEATURES.TOKEN_STATUS;
  if (channel === IPC_CHANNELS.CHAT_CHECK_SUBSCRIBER_ELIGIBILITY) {
    return IPC_FEATURES.CHAT_ELIGIBILITY;
  }
  if (
    channel === IPC_CHANNELS.VIDEOS_GET_CHAT_REPLAY_WINDOW ||
    channel === IPC_CHANNELS.VIDEOS_CANCEL_CHAT_REPLAY_WINDOW
  ) {
    return IPC_FEATURES.CHAT_REPLAY;
  }

  for (const [prefix, feature] of featureByPrefix) {
    if (channel.startsWith(prefix)) return feature;
  }
  return null;
}

export function resolveIpcFeatures(channel: string): readonly IpcFeature[] {
  const feature = resolveIpcFeature(channel);
  if (!feature) return [];
  return playbackChannels.has(channel) ? [feature, IPC_FEATURES.PLAYBACK] : [feature];
}

type Invoke = IpcRenderer["invoke"];
type Send = IpcRenderer["send"];

export interface FeatureAwareIpc {
  invoke: Invoke;
  send: Send;
  loadFeature: (feature: IpcFeature) => Promise<void>;
}

export function createFeatureAwareIpc(invoke: Invoke, send: Send): FeatureAwareIpc {
  const pendingLoads = new Map<IpcFeature, Promise<unknown>>();

  const loadFeature = async (feature: IpcFeature): Promise<void> => {
    let pending = pendingLoads.get(feature);
    if (!pending) {
      pending = invoke(IPC_CHANNELS.IPC_FEATURE_LOAD, feature);
      pendingLoads.set(feature, pending);
      void pending.catch(() => {
        if (pendingLoads.get(feature) === pending) pendingLoads.delete(feature);
      });
    }
    await pending;
  };

  const featureAwareInvoke: Invoke = async (channel: string, ...args: unknown[]) => {
    await Promise.all(resolveIpcFeatures(channel).map(loadFeature));
    return invoke(channel, ...args);
  };

  const featureAwareSend: Send = (channel: string, ...args: unknown[]) => {
    void Promise.all(resolveIpcFeatures(channel).map(loadFeature))
      .then(() => send(channel, ...args))
      .catch(() => undefined);
  };

  return { invoke: featureAwareInvoke, send: featureAwareSend, loadFeature };
}

export function createFeatureAwareInvoke(invoke: Invoke): Invoke {
  return createFeatureAwareIpc(invoke, () => undefined).invoke;
}
