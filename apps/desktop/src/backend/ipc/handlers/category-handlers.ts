import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";

import { logger } from "@backend/logging/logger";
import type { CategoryReader } from "@streamfusion/core/discovery";
import type { Platform } from "../../../shared/auth-types";
import type { DiscoveryResult } from "../../../shared/discovery-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { UnifiedCategory } from "../../../shared/platform-types";

interface CategoryPage {
  data: UnifiedCategory[];
  cursor?: string;
}

const categoryRequests = new Map<string, Promise<CategoryPage>>();

export interface CategoryHandlerDependencies {
  readonly readers: Readonly<Record<Platform, CategoryReader<Platform, UnifiedCategory>>>;
}

function shareCategoryRequest(
  key: string,
  load: () => Promise<CategoryPage>
): Promise<CategoryPage> {
  const existing = categoryRequests.get(key);
  if (existing) return existing;

  const request = load();
  categoryRequests.set(key, request);
  const clear = () => {
    if (categoryRequests.get(key) === request) categoryRequests.delete(key);
  };
  void request.then(clear, clear);
  return request;
}

export function registerCategoryHandlers({ readers }: CategoryHandlerDependencies): void {
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
    ): Promise<DiscoveryResult<UnifiedCategory[]>> => {
      try {
        // Single platform request
        if (params.platform === "twitch") {
          try {
            if (params.limit !== undefined || params.cursor !== undefined) {
              const result = await shareCategoryRequest(
                `twitch:${params.limit ?? "default"}:${params.cursor ?? "first"}`,
                () =>
                  readers.twitch.getTopCategories({
                    limit: params.limit,
                    cursor: params.cursor,
                  })
              );
              return {
                success: true,
                platform: "twitch",
                data: result.data,
                cursor: result.cursor,
                providers: { twitch: "complete" },
              };
            }
            const { data: twitchCategories } = await shareCategoryRequest(
              "twitch:all",
              async () => ({
                data: await readers.twitch.getAllCategories(),
              })
            );
            return {
              success: true,
              platform: "twitch",
              data: twitchCategories,
              providers: { twitch: "complete" },
            };
          } catch (err) {
            logger.warn("IPC:Category", "Failed to fetch Twitch top categories", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
            return {
              success: false,
              error: "Failed to fetch Twitch categories",
              providers: { twitch: "failed" },
            };
          }
        }

        if (params.platform === "kick") {
          try {
            if (params.limit !== undefined || params.cursor !== undefined) {
              const result = await shareCategoryRequest(
                `kick:${params.limit ?? "default"}:${params.cursor ?? "first"}`,
                () =>
                  readers.kick.getTopCategories({
                    limit: params.limit,
                    cursor: params.cursor,
                  })
              );
              return {
                success: true,
                platform: "kick",
                data: result.data,
                cursor: result.cursor,
                providers: { kick: "complete" },
              };
            }
            const { data: kickCategories } = await shareCategoryRequest("kick:all", async () => ({
              data: await readers.kick.getAllCategories(),
            }));
            return {
              success: true,
              platform: "kick",
              data: kickCategories,
              providers: { kick: "complete" },
            };
          } catch (err) {
            logger.warn("IPC:Category", "Failed to fetch Kick top categories", {
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
            return {
              success: false,
              error: "Failed to fetch Kick categories",
              providers: { kick: "failed" },
            };
          }
        }

        // Both platforms - fetch both and return combined
        // De-duplication happens in useCategories hook (Twitch priority, Slots exception)
        const [twitchResult, kickResult] = await Promise.all([
          shareCategoryRequest("twitch:all", async () => ({
            data: await readers.twitch.getAllCategories(),
          }))
            .then((result) => ({ data: result.data, status: "complete" as const }))
            .catch((err) => {
              logger.warn("IPC:Category", "Failed to fetch Twitch top categories", {
                error:
                  err instanceof Error
                    ? { name: err.name, message: err.message, stack: err.stack }
                    : String(err),
              });
              return { data: [] as UnifiedCategory[], status: "failed" as const };
            }),
          shareCategoryRequest("kick:all", async () => ({
            data: await readers.kick.getAllCategories(),
          }))
            .then((result) => ({ data: result.data, status: "complete" as const }))
            .catch((err) => {
              logger.warn("IPC:Category", "Failed to fetch Kick top categories", {
                error:
                  err instanceof Error
                    ? { name: err.name, message: err.message, stack: err.stack }
                    : String(err),
              });
              return { data: [] as UnifiedCategory[], status: "failed" as const };
            }),
        ]);

        // Return combined - frontend handles de-dup and Slots image swap
        const allCategories = [...twitchResult.data, ...kickResult.data];
        return {
          success: true,
          data: allCategories,
          providers: { twitch: twitchResult.status, kick: kickResult.status },
        };
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
          providers: params.platform
            ? { [params.platform]: "failed" }
            : { twitch: "failed", kick: "failed" },
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
      try {
        let category = null;

        category = await readers[params.platform].getCategoryById(params.categoryId);

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
          const { gqlGetGameMetadata } =
            await import("../../api/platforms/twitch/twitch-gql-client");
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
      try {
        const twitchReader =
          !params.platform || params.platform === "twitch" ? readers.twitch : null;
        const kickReader =
          (!params.platform || params.platform === "kick") && !params.after ? readers.kick : null;
        const searchPromises: Promise<{
          platform: Platform;
          data: UnifiedCategory[];
          cursor?: string;
          status: "complete" | "failed";
        }>[] = [];

        if (twitchReader) {
          searchPromises.push(
            twitchReader
              .searchCategories(params.query, {
                limit: params.limit || 20,
                cursor: params.after,
              })
              .then((result) => ({
                platform: "twitch" as Platform,
                data: result.data,
                cursor: result.cursor,
                status: "complete" as const,
              }))
              .catch((err) => {
                logger.warn("IPC:Category", "Failed to search Twitch categories", {
                  error:
                    err instanceof Error
                      ? { name: err.name, message: err.message, stack: err.stack }
                      : String(err),
                });
                return { platform: "twitch" as Platform, data: [], status: "failed" as const };
              })
          );
        }

        // Kick categories don't support cursor pagination — only fetch on first page
        if (kickReader) {
          searchPromises.push(
            kickReader
              .searchCategories(params.query, { limit: params.limit || 20 })
              .then((result) => ({
                platform: "kick" as Platform,
                data: result.data,
                status: "complete" as const,
              }))
              .catch((err) => {
                logger.warn("IPC:Category", "Failed to search Kick categories", {
                  error:
                    err instanceof Error
                      ? { name: err.name, message: err.message, stack: err.stack }
                      : String(err),
                });
                return { platform: "kick" as Platform, data: [], status: "failed" as const };
              })
          );
        }

        const results = await Promise.all(searchPromises);
        const providers = Object.fromEntries(
          results.map((result) => [result.platform, result.status])
        );
        const data = results.flatMap((result) => result.data);
        const hasFailure = results.some((result) => result.status === "failed");

        if (hasFailure && data.length === 0) {
          return {
            success: false,
            error: "Couldn’t search categories on the selected platforms",
            providers,
          };
        }

        if (!params.platform) {
          const twitchCursor = results.find((r) => r.platform === "twitch")?.cursor;
          return { success: true, data, cursor: twitchCursor, providers };
        }

        const result = results[0];
        return {
          success: true,
          data: result?.data ?? [],
          cursor: result?.cursor,
          providers,
        };
      } catch (error) {
        logger.error("IPC:Category", "Failed to search categories", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: "Couldn’t search categories",
          providers: params.platform
            ? { [params.platform]: "failed" as const }
            : { twitch: "failed" as const, kick: "failed" as const },
        };
      }
    }
  );
}
