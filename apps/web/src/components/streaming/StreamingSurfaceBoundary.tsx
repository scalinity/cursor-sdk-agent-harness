import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { useErrorReporter } from "../../hooks/useErrorReporter.js";

export interface StreamingSurfaceBoundaryProps {
  surface: string;
  children: ReactNode;
}

interface InnerProps extends StreamingSurfaceBoundaryProps {
  report: (error: unknown) => void;
  resetKey: number;
  onRetry: () => void;
}

interface InnerState {
  error: Error | null;
}

class StreamingSurfaceBoundaryInner extends Component<InnerProps, InnerState> {
  override state: InnerState = { error: null };

  static getDerivedStateFromError(error: Error): InnerState {
    return { error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.report(error);
  }

  override componentDidUpdate(prevProps: InnerProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (this.state.error) {
      return (
        <button type="button" className="streaming-boundary" onClick={this.props.onRetry}>
          {this.props.surface} failed to render - click to retry
        </button>
      );
    }
    return this.props.children;
  }
}

export function StreamingSurfaceBoundary({ surface, children }: StreamingSurfaceBoundaryProps) {
  const { report } = useErrorReporter(`streaming-${surface}`);
  const [resetKey, setResetKey] = useState(0);
  return (
    <StreamingSurfaceBoundaryInner
      surface={surface}
      report={report}
      resetKey={resetKey}
      onRetry={() => setResetKey((value) => value + 1)}
    >
      {children}
    </StreamingSurfaceBoundaryInner>
  );
}
