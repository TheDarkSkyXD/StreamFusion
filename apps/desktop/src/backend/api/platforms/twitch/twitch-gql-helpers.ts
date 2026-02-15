/**
 * Twitch GQL Helpers
 *
 * Re-exports game data fetching from the centralized GQL client.
 * Kept for backward compatibility with existing imports.
 */

import { gqlFetchGamesForVideos } from "./twitch-gql-client";

export { gqlFetchGamesForVideos as fetchGamesForVideos };

export interface GqlVideoGameData {
  id: string;
  game: {
    id: string;
    displayName: string;
    name?: string;
  } | null;
}
