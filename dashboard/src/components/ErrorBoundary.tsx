import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ui/StateViews';

interface State {
  error: Error | null;
}

/** Catches render errors in a view so one bad value never blanks the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('View crashed', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) return <ErrorState title="Something went wrong showing this view" error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
