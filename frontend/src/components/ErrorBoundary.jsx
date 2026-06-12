import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state" style={{ marginTop: 80 }}>
          <div className="empty-icon">⚠</div>
          <h3>Something went wrong</h3>
          <p className="muted">{String(this.state.error?.message || this.state.error)}</p>
          <button onClick={() => { this.setState({ error: null }); window.location.href = "/"; }}>
            Back to dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
