"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/**
 * Catch-all React error boundary.
 *
 * If anything in the React tree throws during render (a TypeError on a
 * `profile.config.fingerprint.X` access, an `undefined.map`, an exotic
 * date-formatting crash, etc.), the previous behaviour was a fully
 * blank window — the Tauri webview just stops painting, and the user
 * has no obvious way to recover short of quitting and restarting the
 * app. This component intercepts the error, logs it (so the dev /
 * support pipeline still sees it), and renders a focused fallback
 * with a "reload" button.
 *
 * Class component because React Error Boundaries still require the
 * legacy lifecycle methods — there's no hook equivalent as of React 19.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional override of the default fallback UI. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Render crash:", error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <ErrorFallback error={error} onReset={this.reset} />;
  }
}

function ErrorFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-8">
      <div className="flex max-w-lg flex-col gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <h2 className="text-lg font-semibold text-destructive">
          {t("errorBoundary.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("errorBoundary.description")}
        </p>
        <pre className="max-h-40 overflow-auto rounded bg-background/60 p-3 font-mono text-xs text-foreground">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <Button onClick={onReset} variant="outline">
            {t("errorBoundary.retry")}
          </Button>
          <Button onClick={() => window.location.reload()}>
            {t("errorBoundary.reload")}
          </Button>
        </div>
      </div>
    </div>
  );
}
