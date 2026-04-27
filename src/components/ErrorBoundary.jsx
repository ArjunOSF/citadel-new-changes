import React from "react";

/**
 * Simple error boundary — catches render-time errors in the subtree and
 * shows an in-place alert instead of silently unmounting. Essential for
 * template renders where a single bad datum can otherwise blank the whole
 * reconciliation detail page.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", this.props.label || "render", error, info);
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (this.state.error) {
      const { error, info } = this.state;
      return (
        <div className="alert error" style={{ whiteSpace: "normal" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            Something went wrong rendering {this.props.label || "this section"}.
          </div>
          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, marginBottom: 8 }}>
            {String(error?.message || error)}
          </div>
          {info?.componentStack && (
            <details style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "#64748b" }}>
                Component stack
              </summary>
              <pre style={{
                whiteSpace: "pre-wrap",
                fontSize: 11,
                background: "#fff1f2",
                padding: 8,
                borderRadius: 4,
                marginTop: 4,
              }}>{info.componentStack}</pre>
            </details>
          )}
          <button className="btn ghost small" onClick={this.reset}>Dismiss</button>
        </div>
      );
    }
    return this.props.children;
  }
}
