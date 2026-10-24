import { Component, type ReactNode } from 'react';
import { ErrorState } from '../components/ui';

/** Last-resort screen. Never shows document content or stack traces; data on disk is untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen no-nav" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="ambient" />
        <ErrorState
          title="Something went wrong"
          message="The app hit an unexpected problem. Your documents are safe on this device."
          onRetry={() => {
            window.location.href = '/';
          }}
        />
      </div>
    );
  }
}
