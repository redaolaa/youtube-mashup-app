import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("App error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "2rem", maxWidth: "480px", margin: "0 auto", textAlign: "center",
          color: "#e5e5e5", fontFamily: "system-ui, sans-serif"
        }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
          <p style={{ color: "#94a3b8", fontSize: "0.9rem", marginBottom: "1rem" }}>
            {this.state.error?.message || "The app hit an error. Try reloading."}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "0.5rem 1rem", fontSize: "1rem", cursor: "pointer",
              background: "#3b82f6", color: "white", border: "none", borderRadius: "8px"
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
