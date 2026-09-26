import type React from "react";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { RecoveryBoundary } from "@/features/shell/components/recovery/RecoveryBoundary";

const PageLoader = () => {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-label={t("shell.loadingPage")}
      data-route-page-loader="true"
      className="flex h-full items-center justify-center"
    >
      <LoadingSpinner size="md" className="motion-reduce:animate-none" />
    </div>
  );
};

export const withSuspense = (
  Component: React.ComponentType & { preload?: () => Promise<unknown> },
  { forwardPreload = false }: { forwardPreload?: boolean } = {}
) => {
  const SuspenseComponent = () => (
    <RecoveryBoundary name="This page">
      <Suspense fallback={<PageLoader />}>
        <Component />
      </Suspense>
    </RecoveryBoundary>
  );

  return forwardPreload
    ? Object.assign(SuspenseComponent, { preload: Component.preload })
    : SuspenseComponent;
};
