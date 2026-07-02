import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time errors so a crash shows a readable message instead of a
 * blank white screen (which previously looked like "KPIs not loading").
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[dashboard] render error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-3xl">🛑</div>
          <h1 className="text-xl font-bold text-critical">Dashboard crashed while rendering</h1>
          <p className="max-w-lg text-sm text-text-muted">
            A component threw an error. This is the cause of the blank screen — the
            details below (and the browser console) show what failed.
          </p>
          <pre className="max-w-2xl overflow-auto rounded border border-border bg-surface p-3 text-left text-xs text-warning">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            Retry render
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
