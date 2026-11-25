"use client";

import { Component, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";

class Boundary extends Component<{ title: string; onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Panel title={this.props.title}>
        <WidgetErrorState description="This panel could not be shown." onRetry={() => { this.setState({ failed: false }); this.props.onRetry(); }} />
      </Panel>
    );
  }
}

/** If one panel breaks while it is drawn, only that panel shows an error, with Retry; the rest of Home stays. */
export function PanelBoundary({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return <Boundary title={title} onRetry={() => router.refresh()}>{children}</Boundary>;
}
