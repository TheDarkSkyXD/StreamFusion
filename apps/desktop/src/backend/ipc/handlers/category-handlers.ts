import { ipcMain } from "electron";

import { logger } from "@/backend/logging/logger";
import type { Platform } from "../../../shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { UnifiedCategory } from "../../api/unified/platform-types";

export function registerCategoryHandlers(): void {
  /**
   * Get top categories from one or both platforms
   *
   * When fetching both platforms, returns all categories from both.
   * De-duplication and merging logic (Twitch priority, Slots exception)
   * is handled in the useCategories hook on the frontend.
   */
  ipcMain.handle(
    IPC_CHANNELS.CATEGORIES_GET_TOP,
    async (
      _event,
      params: {
        platform?: Platform;
        limit?: number;
        cursor?: string;
      } = {}
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        // Single platform request
        if (params.platform === "twitch") {
          try {
            const twitchCategories = await twitchClient.getAllTopCategories();
            return { success: true, platform: "twitch", data: twitchCategories };
          } catch (err) {
            logger.warn("IPC:Category", "Failed to fetch Twitch top categories", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
            return { success: false, error: "Failed to fetch Twitch categories" };
          }
        }

        if (params.platform === "kick") {
          try {
            const kickCategories = await kickClient.getAllCategories();
            return { success: true, platform: "kick", data: kickCategories };
          } catch (err) {
            logger.warn("IPC:Category", "Failed to fetch Kick top categories", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
            return { success: false, error: "Failed to fetch Kick categories" };
          }
        }

        // Both platforms - fetch both and return combined
        // De-duplication happens in useCategories hook (Twitch priority, Slots exception)
        let twitchCategories: UnifiedCategory[] = [];
        let kickCategories: UnifiedCategory[] = [];

        try {
          // Fetch ALL Twitch categories
          twitchCategories = await twitchClient.getAllTopCategories();
        } catch (err) {
          logger.warn("IPC:Category", "Failed to fetch Twitch top categories", {
            error:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : String(err),
          });
        }

        try {
          // Fetch Kick categories (rate-limited sequential fetch)
          kickCategories = await kickClient.getAllCategories();
        } catch (err) {
          logger.warn("IPC:Category", "Failed to fetch Kick top categories", {
            error:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : String(err),
          });
        }

        // Return combined - frontend handles de-dup and Slots image swap
        const allCategories = [...twitchCategories, ...kickCategories];
        return { success: true, data: allCategories };
      } catch (error) {
        logger.error("IPC:Category", "Failed to get top categories", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch categories",
        };
      }
    }
  );

  /**
   * Get category by ID
   */
  ipcMain.handle(
    IPC_CHANNELS.CATEGORIES_GET_BY_ID,
    async (
      _event,
      params: {
        platform: Platform;
        categoryId: string;
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        let category = null;

        if (params.platform === "twitch") {
          category = await twitchClient.getCategoryById(params.categoryId);
        } else if (params.platform === "kick") {
          category = await kickClient.getCategoryById(params.categoryId);
        }

        return { success: true, data: category };
      } catch (error) {
        logger.error("IPC:Category", "Failed to get category by ID", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch category",
        };
      }
    }
  );

  /**
   * Per-card Twitch tag fetch (single raw GQL query against `Game.tags`).
   *
   * Twitch's Helix /games/top response doesn't carry tags, so we lazy-load
   * them per-card on render. The virtualized grid only mounts visible cards,
   * so the fan-out is bounded. Kick is intentionally not routed here — its
   * tags already travel on the category object via the bulk
   * /private/v1/categories fetch.
   */
  ipcMain.handle(
    IPC_CHANNELS.CATEGORIES_GET_METADATA,
    async (
      _event,
      params: {
        platform: Platform;
        categoryId: string;
        slug?: string;
      }
    ) => {
      try {
        if (params.platform === "twitch") {
          const { gqlGetGameMetadata } = await import(
            "../../api/platforms/twitch/twitch-gql-client"
          );
          const meta = await gqlGetGameMetadata(params.categoryId);
          return { success: true, data: { tags: meta?.tags ?? [] } };
        }
        // Kick tags ride on the category object from the bulk list endpoint,
        // so this handler is a no-op for Kick. The hook also gates on
        // platform === "twitch", so this branch is just a safety net.
        return { success: true, data: { tags: undefined } };
      } catch (error) {
        logger.error("IPC:Category", "Failed to get category metadata", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch metadata",
        };
      }
    }
  );

  /**
   * Search categories
   */
  ipcMain.handle(
    IPC_CHANNELS.CATEGORIES_SEARCH,
    async (
      _event,
      params: {
        query: string;
        platform?: Platform;
        limit?: number;
        after?: string;
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        const results: { platform: Platform; data: any[]; cursor?: string }[] = [];

        if (!params.platform || params.platform === "twitch") {
          try {
            const result = await twitchClient.searchCategories(params.query, {
              first: params.limit || 20,
              after: params.after,
            });
            results.push({ platform: "twitch", data: result.data, cursor: result.cursor });
          } catch (err) {
            logger.warn("IPC:Category", "Failed to search Twitch categories", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
          }
        }

        // Kick categories don't support cursor pagination — only fetch on first page
        if ((!params.platform || params.platform === "kick") && !params.after) {
          try {
            const result = await kickClient.searchCategories(params.query);
            results.push({ platform: "kick", data: result.data });
          } catch (err) {
            logger.warn("IPC:Category", "Failed to search Kick categories", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
          }
        }

        if (!params.platform) {
          const allCategories = results.flatMap((r) => r.data);
          const twitchCursor = results.find((r) => r.platform === "twitch")?.cursor;
          return { success: true, data: allCategories, cursor: twitchCursor };
        }

        const { platform: _p, ...rest } = results[0] ?? { data: [] };
        return { success: true, ...rest };
      } catch (error) {
        logger.error("IPC:Category", "Failed to search categories", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return { success: false, error: error instanceof Error ? error.message : "Search failed" };
      }
    }
  );
}
