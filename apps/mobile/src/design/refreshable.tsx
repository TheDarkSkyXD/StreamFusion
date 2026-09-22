import { useCallback, useState, type ComponentProps, type ReactNode } from "react";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  type FlatListProps,
  type ScrollViewProps,
} from "react-native";

import { selectionHaptic } from "./haptics";
import { mobileColors } from "./tokens";

export type MobileRefreshHandler = () => void | Promise<void>;

function refreshControlNode(input: {
  readonly onRefresh: MobileRefreshHandler;
  readonly refreshing: boolean;
}): ReactNode {
  return (
    <RefreshControl
      colors={[mobileColors.textPrimary]}
      onRefresh={() => {
        void (async () => {
          await input.onRefresh();
          void selectionHaptic();
        })();
      }}
      progressBackgroundColor={mobileColors.surface}
      refreshing={input.refreshing}
      tintColor={mobileColors.textPrimary}
      titleColor={mobileColors.textSecondary}
    />
  );
}

/**
 * ScrollView with optional pull-to-refresh.
 * Prefer passing `refreshing` from the screen query (`isFetching`) so this
 * stays hook-free and compatible with function-call UI unit tests.
 */
export function MobileRefreshableScroll({
  children,
  onRefresh,
  refreshing = false,
  testID,
  ...rest
}: ScrollViewProps & {
  readonly children: ReactNode;
  readonly onRefresh?: MobileRefreshHandler | undefined;
  readonly refreshing?: boolean | undefined;
  readonly testID?: string | undefined;
}) {
  const refreshControl =
    onRefresh === undefined
      ? undefined
      : refreshControlNode({ onRefresh, refreshing: refreshing ?? false });
  return (
    <ScrollView
      {...rest}
      {...(refreshControl === undefined ? {} : { refreshControl })}
      {...(testID === undefined ? {} : { testID })}
    >
      {children}
    </ScrollView>
  );
}

/** Optional local refreshing latch for screens without a query `isFetching`. */
export function useMobileRefresh(onRefresh: MobileRefreshHandler | undefined | null): {
  readonly refreshing: boolean;
  readonly onRefresh: (() => void) | undefined;
} {
  const [refreshing, setRefreshing] = useState(false);
  const run = useCallback(() => {
    if (!onRefresh) return;
    setRefreshing(true);
    void (async () => {
      try {
        await onRefresh();
        void selectionHaptic();
      } finally {
        setRefreshing(false);
      }
    })();
  }, [onRefresh]);

  if (!onRefresh) {
    return { refreshing: false, onRefresh: undefined };
  }

  return { refreshing, onRefresh: run };
}

export function mobileRefreshControlProps(input: {
  readonly onRefresh?: MobileRefreshHandler | undefined;
  readonly refreshing: boolean;
}):
  | Pick<
      ComponentProps<typeof RefreshControl>,
      | "colors"
      | "onRefresh"
      | "progressBackgroundColor"
      | "refreshing"
      | "tintColor"
      | "titleColor"
    >
  | undefined {
  if (!input.onRefresh) return undefined;
  return {
    colors: [mobileColors.textPrimary],
    onRefresh: () => {
      void (async () => {
        await input.onRefresh?.();
        void selectionHaptic();
      })();
    },
    progressBackgroundColor: mobileColors.surface,
    refreshing: input.refreshing,
    tintColor: mobileColors.textPrimary,
    titleColor: mobileColors.textSecondary,
  };
}

export function MobileRefreshableFlatList<ItemT>(
  props: FlatListProps<ItemT> & {
    readonly onRefresh?: MobileRefreshHandler | undefined;
  },
): ReactNode {
  const { onRefresh, refreshing = false, ...rest } = props;
  return (
    <FlatList
      {...rest}
      {...(onRefresh === undefined
        ? {}
        : {
            onRefresh: () => {
              void (async () => {
                await onRefresh();
                void selectionHaptic();
              })();
            },
            refreshing: refreshing ?? false,
          })}
    />
  );
}
