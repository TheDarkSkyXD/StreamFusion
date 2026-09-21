export function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "") {
      labels.push(entry);
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name =
      typeof record.name === "string"
        ? record.name
        : typeof record.tag === "string"
          ? record.tag
          : "";
    if (name.trim() !== "") labels.push(name);
  }
  return labels;
}

export function helixTags(record: Record<string, unknown>): readonly string[] {
  return stringList(record.tags);
}

export function kickTags(record: Record<string, unknown>): readonly string[] {
  const custom = stringList(record.custom_tags);
  if (custom.length > 0) return custom;
  const nested =
    objectField(record, "livestream") ?? objectField(record, "stream");
  if (nested) {
    const liveCustom = stringList(nested.custom_tags);
    if (liveCustom.length > 0) return liveCustom;
    const liveTags = stringList(nested.tags);
    if (liveTags.length > 0) return liveTags;
  }
  return stringList(record.tags);
}

export function gqlTags(record: Record<string, unknown>): readonly string[] {
  const freeform = stringList(record.freeformTags);
  return freeform.length > 0 ? freeform : stringList(record.tags);
}

export function twitchChannelVerified(broadcasterType: string): boolean {
  return broadcasterType !== "";
}

export function twitchStreamVerified(broadcasterType: string): boolean {
  return broadcasterType === "partner";
}

export function gqlBroadcasterPartner(
  broadcaster: Record<string, unknown> | null,
): boolean {
  if (broadcaster === null) return false;
  const roles = objectField(broadcaster, "roles");
  return roles?.isPartner === true;
}

export function gqlBroadcasterVerified(
  broadcaster: Record<string, unknown> | null,
): boolean {
  if (broadcaster === null) return false;
  const roles = objectField(broadcaster, "roles");
  return roles?.isPartner === true || roles?.isAffiliate === true;
}

export function kickVerified(record: Record<string, unknown>): boolean {
  const user = objectField(record, "user") ?? {};
  const streamer = objectField(record, "streamer");
  const streamerUser = streamer ? (objectField(streamer, "user") ?? {}) : {};
  return (
    flagged(record.verified) ||
    record.is_verified === true ||
    flagged(user.verified) ||
    user.is_verified === true ||
    flagged(streamerUser.verified) ||
    streamerUser.is_verified === true
  );
}

export function objectField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function flagged(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "object" && value !== null && "id" in value) {
    return Boolean((value as { id: unknown }).id);
  }
  return false;
}
