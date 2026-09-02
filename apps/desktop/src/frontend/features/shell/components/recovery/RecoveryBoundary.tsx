import React from "react";
import { useTranslation } from "react-i18next";
import { LuRefreshCw, LuTriangleAlert } from "react-icons/lu";

import { logger } from "@/renderer/logging/logger";

interface RecoveryBoundaryProps {
  children: React.ReactNode;
  level?: "app" | "region";
  name: string;
  resetKey?: string;
}

interface RecoveryBoundaryState {
  diagnosticId: string | null;
  failed: boolean;
}

function diagnosticId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `renderer-${Date.now().toString(36)}`;
  }
}

function RecoveryFallback({
  isApp,
  name,
  diagnosticId: currentDiagnosticId,
  onReload,
  onRetry,
}: {
  isApp: boolean;
  name: string;
  diagnosticId: string | null;
  onReload: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className={
        isApp
          ? "flex h-screen w-screen items-center justify-center bg-[var(--color-background)] p-6"
          : "flex h-full min-h-48 w-full items-center justify-center p-4"
      }
    >
      <div className="w-full max-w-md rounded-xl border border-amber-400/30 bg-[var(--color-background-secondary)] p-6 text-center shadow-xl">
        <LuTriangleAlert className="mx-auto h-8 w-8 text-amber-300" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold text-white">
          {isApp ? t("shell.recovery.appTitle") : t("shell.recovery.regionTitle", { name })}
        </h1>
        <p className="mt-2 text-sm text-[var(--color-foreground-secondary)]">
          {isApp ? t("shell.recovery.appDescription") : t("shell.recovery.regionDescription")}
        </p>
        {currentDiagnosticId && (
          <p className="mt-3 text-xs text-[var(--color-foreground-muted)]">
            {t("shell.recovery.diagnosticId")}: {currentDiagnosticId}
          </p>
        )}
        <button
          type="button"
          autoFocus
          onClick={isApp ? onReload : onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <LuRefreshCw className="h-4 w-4" aria-hidden="true" />
          {isApp ? t("shell.recovery.reloadApp") : t("shell.recovery.tryAgain")}
        </button>
      </div>
    </div>
  );
}

export class RecoveryBoundary extends React.Component<
  RecoveryBoundaryProps,
  RecoveryBoundaryState
> {
  state: RecoveryBoundaryState = { diagnosticId: null, failed: false };

  static getDerivedStateFromError(): RecoveryBoundaryState {
    return { diagnosticId: diagnosticId(), failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      logger.error("Renderer:Boundary", "React region failed", {
        name: this.props.name,
        diagnosticId: this.state.diagnosticId,
        error: { name: error.name, message: error.message, stack: error.stack },
        componentStack: info.componentStack,
      });
    } catch {
      // Recovery UI must remain available even if diagnostic transport failed.
    }
  }

  componentDidUpdate(previousProps: RecoveryBoundaryProps): void {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ diagnosticId: null, failed: false });
    }
  }

  private retry = (): void => {
    this.setState({ diagnosticId: null, failed: false });
  };

  private reload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <RecoveryFallback
        isApp={this.props.level === "app"}
        name={this.props.name}
        diagnosticId={this.state.diagnosticId}
        onReload={this.reload}
        onRetry={this.retry}
      />
    );
  }
}
