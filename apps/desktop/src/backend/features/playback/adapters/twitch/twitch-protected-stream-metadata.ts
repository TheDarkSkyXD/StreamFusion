import { getRawQuery } from "twitch-gql-queries";

import { gqlRequest } from "@backend/api/platforms/twitch/twitch-gql-client";

interface StreamMetadata {
  user?: { stream?: { isEncrypted?: unknown } | null } | null;
}

const STREAM_METADATA_QUERY = `query VideoPlayerStreamMetadata($login: String!) {
  user(login: $login) {
    stream { isEncrypted }
  }
}`;

export async function isTwitchStreamEncrypted(login: string): Promise<boolean> {
  const [response] = await gqlRequest([
    getRawQuery<StreamMetadata>({ query: STREAM_METADATA_QUERY, variables: { login } }),
  ]);
  return response.data?.user?.stream?.isEncrypted === true;
}
