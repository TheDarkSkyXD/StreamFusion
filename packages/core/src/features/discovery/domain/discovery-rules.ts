export interface DiscoveryIdentity {
  readonly id: string;
  readonly platform: string;
}

export interface ChannelSearchCandidate extends DiscoveryIdentity {
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string;
  readonly bannerUrl?: string;
  readonly bio?: string;
  readonly isLive: boolean;
  readonly isVerified: boolean;
  readonly isPartner: boolean;
  readonly followerCount?: number;
}

export interface CategorySearchCandidate extends DiscoveryIdentity {
  readonly name: string;
  readonly tags?: readonly string[];
  readonly viewerCount?: number;
}

export interface StreamSearchCandidate extends DiscoveryIdentity {
  readonly channelName: string;
  readonly channelDisplayName: string;
  readonly title: string;
  readonly categoryName?: string;
  readonly tags: readonly string[];
  readonly language: string;
  readonly viewerCount: number;
  readonly isLive: boolean;
}

export interface RecentContentSearchCandidate extends DiscoveryIdentity {
  readonly channelName: string;
  readonly channelDisplayName: string;
  readonly title: string;
  readonly viewCount: number;
}

export interface VideoSearchCandidate extends RecentContentSearchCandidate {
  readonly publishedAt: string;
}

export interface ClipSearchCandidate extends RecentContentSearchCandidate {
  readonly createdAt: string;
}

export interface SearchMatchRank {
  readonly tier: number;
  readonly editDistance: number;
}

export type ChannelSearchRank = SearchMatchRank;
export type CategorySearchMatchRank = SearchMatchRank;

const SEARCH_GRAPHEME_SEGMENTER = new Intl.Segmenter("en", {
  granularity: "grapheme",
});
const WORD_GRAPHEME_PATTERN = /^[\p{L}\p{N}]+$/u;
const EMOJI_GRAPHEME_PATTERN =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function normalizeSearchTokens(query: string): string[] {
  const normalized = query
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
  const uniqueTokens = new Set<string>();
  let word = "";
  const flushWord = () => {
    if (word) uniqueTokens.add(word);
    word = "";
  };

  for (const { segment } of SEARCH_GRAPHEME_SEGMENTER.segment(normalized)) {
    if (WORD_GRAPHEME_PATTERN.test(segment)) {
      word += segment;
      continue;
    }
    flushWord();
    if (EMOJI_GRAPHEME_PATTERN.test(segment)) uniqueTokens.add(segment);
  }
  flushWord();
  return [...uniqueTokens];
}

export function normalizeSearchQuery(query: string): string {
  return normalizeSearchTokens(query).join(" ");
}

export function compactSearchIdentity(value: string): string {
  return normalizeSearchTokens(value).join("");
}

function normalizedPhrase(value: string): string {
  return normalizeSearchTokens(value).join(" ");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isOneDamerauEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    const differences: number[] = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences.push(index);
      if (differences.length > 2) return false;
    }
    const firstDifference = differences[0];
    const secondDifference = differences[1];
    return (
      differences.length === 1 ||
      (differences.length === 2 &&
        firstDifference !== undefined &&
        secondDifference !== undefined &&
        secondDifference === firstDifference + 1 &&
        left[firstDifference] === right[secondDifference] &&
        left[secondDifference] === right[firstDifference])
    );
  }

  const longer = left.length > right.length ? left : right;
  const shorter = left.length > right.length ? right : left;
  let longerIndex = 0;
  let shorterIndex = 0;
  let skipped = false;
  while (longerIndex < longer.length && shorterIndex < shorter.length) {
    if (longer[longerIndex] === shorter[shorterIndex]) {
      longerIndex += 1;
      shorterIndex += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    longerIndex += 1;
  }
  return true;
}

function tokenDistance(
  token: string,
  fields: readonly string[],
): number | null {
  let fuzzy = false;
  for (const field of fields) {
    for (const candidate of normalizeSearchTokens(field)) {
      if (candidate.includes(token)) return 0;
      if (token.length >= 5 && isOneDamerauEdit(token, candidate)) fuzzy = true;
    }
  }
  return fuzzy ? 1 : null;
}

function rankFields(
  query: string,
  fieldGroups: readonly (readonly string[])[],
): SearchMatchRank | null {
  const tokens = normalizeSearchTokens(query);
  if (tokens.length === 0) return null;
  if (tokens.length === 1 && Array.from(tokens[0] ?? "").length === 1) {
    return null;
  }

  let tier = 0;
  let editDistance = 0;
  for (const token of tokens) {
    let matched = false;
    for (let groupIndex = 0; groupIndex < fieldGroups.length; groupIndex += 1) {
      const fields = fieldGroups[groupIndex];
      if (!fields) continue;
      const distance = tokenDistance(token, fields);
      if (distance === null) continue;
      tier = Math.max(tier, groupIndex + 2);
      editDistance = Math.max(editDistance, distance);
      matched = true;
      break;
    }
    if (!matched) return null;
  }
  return { tier, editDistance };
}

export function isExactChannelSearchMatch(
  channel: Pick<ChannelSearchCandidate, "username" | "displayName">,
  query: string,
): boolean {
  const queryIdentity = compactSearchIdentity(query);
  return (
    queryIdentity.length > 0 &&
    [channel.username, channel.displayName].some(
      (field) => compactSearchIdentity(field) === queryIdentity,
    )
  );
}

export function rankChannelMatch(
  channel: Pick<ChannelSearchCandidate, "username" | "displayName">,
  query: string,
): ChannelSearchRank | null {
  const queryTokens = normalizeSearchTokens(query);
  if (queryTokens.length === 0) return null;
  const fields = [channel.username, channel.displayName];
  const queryIdentity = compactSearchIdentity(query);
  if (fields.some((field) => compactSearchIdentity(field) === queryIdentity)) {
    return { tier: 0, editDistance: 0 };
  }
  if (
    fields.some((field) =>
      compactSearchIdentity(field).startsWith(queryIdentity),
    )
  ) {
    return { tier: 1, editDistance: 0 };
  }
  if (queryTokens.length === 1 && queryTokens[0]?.length === 1) return null;

  let editDistance = 0;
  for (const token of queryTokens) {
    const distances = fields
      .map((field) => tokenDistance(token, [field]))
      .filter((distance): distance is number => distance !== null);
    if (distances.length === 0) return null;
    editDistance = Math.max(editDistance, Math.min(...distances));
  }
  return { tier: 2, editDistance };
}

function trustworthyCount(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function compareStableChannelIdentity(
  left: ChannelSearchCandidate,
  right: ChannelSearchCandidate,
): number {
  return (
    compareText(
      normalizedPhrase(left.displayName),
      normalizedPhrase(right.displayName),
    ) ||
    compareText(
      normalizedPhrase(left.username),
      normalizedPhrase(right.username),
    ) ||
    compareText(left.platform, right.platform) ||
    compareText(left.id, right.id)
  );
}

function duplicateChannelFingerprint(channel: ChannelSearchCandidate): string {
  return [
    channel.displayName,
    channel.username,
    channel.avatarUrl,
    channel.bannerUrl ?? "",
    channel.bio ?? "",
    String(channel.isLive),
    String(channel.isVerified),
    String(channel.isPartner),
  ].join("\u0000");
}

function compareDuplicateChannelQuality(
  left: ChannelSearchCandidate,
  right: ChannelSearchCandidate,
): number {
  const leftFollowers = trustworthyCount(left.followerCount);
  const rightFollowers = trustworthyCount(right.followerCount);
  return (
    Number(leftFollowers === undefined) -
      Number(rightFollowers === undefined) ||
    (rightFollowers ?? 0) - (leftFollowers ?? 0) ||
    Number(!left.avatarUrl) - Number(!right.avatarUrl) ||
    compareText(
      duplicateChannelFingerprint(left),
      duplicateChannelFingerprint(right),
    )
  );
}

export function rankSearchChannels<TChannel extends ChannelSearchCandidate>(
  channels: readonly TChannel[],
  query: string,
): TChannel[] {
  const byIdentity = new Map<string, TChannel>();
  for (const channel of channels) {
    const identity = `${channel.platform}:${channel.id}`;
    const existing = byIdentity.get(identity);
    if (!existing || compareDuplicateChannelQuality(channel, existing) < 0) {
      byIdentity.set(identity, channel);
    }
  }

  return [...byIdentity.values()]
    .flatMap((channel) => {
      const rank = rankChannelMatch(channel, query);
      return rank
        ? [
            {
              channel,
              rank,
              followerCount: trustworthyCount(channel.followerCount),
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        left.rank.tier - right.rank.tier ||
        left.rank.editDistance - right.rank.editDistance ||
        Number(left.followerCount === undefined) -
          Number(right.followerCount === undefined) ||
        (right.followerCount ?? 0) - (left.followerCount ?? 0) ||
        compareStableChannelIdentity(left.channel, right.channel),
    )
    .map((entry) => entry.channel);
}

export function rankCategoryMatch(
  category: Pick<CategorySearchCandidate, "name" | "tags">,
  query: string,
): CategorySearchMatchRank | null {
  const tokens = normalizeSearchTokens(query);
  if (
    tokens.length === 0 ||
    (tokens.length === 1 && Array.from(tokens[0] ?? "").length === 1)
  ) {
    return null;
  }
  const phrase = tokens.join(" ");
  const name = normalizedPhrase(category.name);
  if (name === phrase) return { tier: 0, editDistance: 0 };
  if (name.startsWith(phrase)) return { tier: 1, editDistance: 0 };

  let tier = 0;
  let editDistance = 0;
  for (const token of tokens) {
    const nameDistance = tokenDistance(token, [category.name]);
    const tagDistance =
      nameDistance === null ? tokenDistance(token, category.tags ?? []) : null;
    const distance = nameDistance ?? tagDistance;
    if (distance === null) return null;
    tier = Math.max(tier, nameDistance === null ? 3 : 2);
    editDistance = Math.max(editDistance, distance);
  }
  return { tier, editDistance };
}

export function rankAndDeduplicateCategories<
  TCategory extends CategorySearchCandidate,
>(categories: readonly TCategory[], query: string): TCategory[] {
  const byIdentity = new Map<string, TCategory>();
  for (const category of categories) {
    byIdentity.set(`${category.platform}:${category.id}`, category);
  }
  return [...byIdentity.values()]
    .flatMap((category) => {
      const match = rankCategoryMatch(category, query);
      return match ? [{ category, ...match }] : [];
    })
    .sort(
      (left, right) =>
        left.tier - right.tier ||
        left.editDistance - right.editDistance ||
        (right.category.viewerCount ?? 0) - (left.category.viewerCount ?? 0) ||
        `${normalizedPhrase(left.category.name)}:${left.category.platform}:${left.category.id}`.localeCompare(
          `${normalizedPhrase(right.category.name)}:${right.category.platform}:${right.category.id}`,
        ),
    )
    .map((entry) => entry.category);
}

function rankIdentityAndFields(
  identityFields: readonly string[],
  fieldGroups: readonly (readonly string[])[],
  query: string,
  exactFields: readonly string[] = [],
): SearchMatchRank | null {
  const tokens = normalizeSearchTokens(query);
  if (tokens.length === 0) return null;
  if (tokens.length === 1 && Array.from(tokens[0] ?? "").length === 1) {
    return null;
  }
  const phrase = tokens.join(" ");
  const identities = identityFields.map(normalizedPhrase);
  if (
    identities.includes(phrase) ||
    exactFields.some((field) => normalizedPhrase(field) === phrase)
  ) {
    return { tier: 0, editDistance: 0 };
  }
  if (identities.some((field) => field.startsWith(phrase))) {
    return { tier: 1, editDistance: 0 };
  }
  return rankFields(query, fieldGroups);
}

export function rankStreamMatch(
  stream: Pick<
    StreamSearchCandidate,
    | "channelName"
    | "channelDisplayName"
    | "title"
    | "categoryName"
    | "tags"
    | "language"
  >,
  query: string,
): SearchMatchRank | null {
  const identities = [stream.channelName, stream.channelDisplayName];
  return rankIdentityAndFields(
    identities,
    [
      identities,
      [stream.title],
      stream.categoryName ? [stream.categoryName] : [],
      [...stream.tags, stream.language],
    ],
    query,
  );
}

export function rankVideoMatch(
  video: Pick<
    VideoSearchCandidate,
    "channelName" | "channelDisplayName" | "title"
  >,
  query: string,
): SearchMatchRank | null {
  const identities = [video.channelName, video.channelDisplayName];
  return rankIdentityAndFields(identities, [identities, [video.title]], query, [
    video.title,
  ]);
}

export function rankClipMatch(
  clip: Pick<
    ClipSearchCandidate,
    "channelName" | "channelDisplayName" | "title"
  >,
  query: string,
): SearchMatchRank | null {
  return rankVideoMatch(clip, query);
}

function rankAndDeduplicate<TItem extends DiscoveryIdentity>(options: {
  readonly items: readonly TItem[];
  readonly query: string;
  readonly rank: (item: TItem, query: string) => SearchMatchRank | null;
  readonly popularity: (item: TItem) => number;
  readonly timestamp?: (item: TItem) => number;
  readonly stableKey: (item: TItem) => string;
}): TItem[] {
  const byIdentity = new Map<string, TItem>();
  for (const item of options.items) {
    const identity = `${item.platform}:${item.id}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, item);
  }
  return [...byIdentity.values()]
    .flatMap((item) => {
      const rank = options.rank(item, options.query);
      return rank
        ? [
            {
              item,
              rank,
              popularity: options.popularity(item),
              timestamp: options.timestamp?.(item) ?? 0,
              stableKey: options.stableKey(item),
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        left.rank.tier - right.rank.tier ||
        left.rank.editDistance - right.rank.editDistance ||
        right.popularity - left.popularity ||
        right.timestamp - left.timestamp ||
        left.stableKey.localeCompare(right.stableKey),
    )
    .map((entry) => entry.item);
}

export function rankAndDeduplicateStreams<
  TStream extends StreamSearchCandidate,
>(streams: readonly TStream[], query: string): TStream[] {
  return rankAndDeduplicate({
    items: streams.filter((stream) => stream.isLive),
    query,
    rank: rankStreamMatch,
    popularity: (stream) => stream.viewerCount,
    stableKey: (stream) =>
      `${normalizedPhrase(stream.channelName)}:${stream.platform}:${stream.id}`,
  });
}

export function rankAndDeduplicateVideos<TVideo extends VideoSearchCandidate>(
  videos: readonly TVideo[],
  query: string,
): TVideo[] {
  return rankAndDeduplicate({
    items: videos,
    query,
    rank: rankVideoMatch,
    popularity: (video) => video.viewCount,
    timestamp: (video) => Date.parse(video.publishedAt),
    stableKey: (video) =>
      `${normalizedPhrase(video.channelName)}:${video.platform}:${video.id}`,
  });
}

export function rankAndDeduplicateClips<TClip extends ClipSearchCandidate>(
  clips: readonly TClip[],
  query: string,
): TClip[] {
  return rankAndDeduplicate({
    items: clips,
    query,
    rank: rankClipMatch,
    popularity: (clip) => clip.viewCount,
    timestamp: (clip) => Date.parse(clip.createdAt),
    stableKey: (clip) =>
      `${normalizedPhrase(clip.channelName)}:${clip.platform}:${clip.id}`,
  });
}
