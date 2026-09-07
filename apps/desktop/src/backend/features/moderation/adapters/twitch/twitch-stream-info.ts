import { z } from "zod";
import {
  EDITABLE_CONTENT_CLASSIFICATION_LABELS,
  type StreamInfo,
  type StreamInfoUpdate,
} from "@shared/moderation-types";
import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import {
  emptyResponseSchema,
  query,
  requestDecoded,
} from "@backend/api/platforms/twitch/twitch-command-request";

const channelInformation = z.object({
  data: z.array(
    z.object({
      broadcaster_id: z.string(),
      title: z.string(),
      game_id: z.string(),
      game_name: z.string(),
      broadcaster_language: z.string(),
      tags: z.array(z.string()),
      content_classification_labels: z.array(z.string()),
    })
  ),
});
const labelsResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
    })
  ),
});
const editableLabelId = z.enum(EDITABLE_CONTENT_CLASSIFICATION_LABELS);

export async function readStreamInfo(
  requestor: TwitchHelixRequestPort,
  broadcasterId: string
): Promise<StreamInfo> {
  const response = await requestDecoded(
    requestor,
    channelInformation,
    query("/channels", { broadcaster_id: broadcasterId })
  );
  const channel = response.data.find((item) => item.broadcaster_id === broadcasterId);
  if (!channel) throw new Error("Twitch did not return the requested channel.");
  const labels = await requestDecoded(
    requestor,
    labelsResponse,
    "/content_classification_labels?locale=en-US"
  );
  return {
    broadcasterId: channel.broadcaster_id,
    title: channel.title,
    category: { id: channel.game_id, name: channel.game_name },
    language: channel.broadcaster_language,
    tags: channel.tags,
    contentClassificationLabels: channel.content_classification_labels,
    availableContentClassificationLabels: labels.data.flatMap((label) => {
      const parsed = editableLabelId.safeParse(label.id);
      return parsed.success ? [{ ...label, id: parsed.data }] : [];
    }),
  };
}

export async function updateStreamInfo(
  requestor: TwitchHelixRequestPort,
  broadcasterId: string,
  settings: StreamInfoUpdate
): Promise<void> {
  await requestDecoded(
    requestor,
    emptyResponseSchema,
    query("/channels", { broadcaster_id: broadcasterId }),
    {
      method: "PATCH",
      body: JSON.stringify({
        title: settings.title,
        game_id: settings.categoryId,
        broadcaster_language: settings.language,
        tags: settings.tags,
        content_classification_labels: settings.contentClassificationLabels?.map((label) => ({
          id: label.id,
          is_enabled: label.enabled,
        })),
      }),
    }
  );
}
