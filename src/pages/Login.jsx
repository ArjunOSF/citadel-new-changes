import React, { useState } from "react";
import osfinLogo from "../assets/osfin-logo.svg";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onLogin(username.trim(), password);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const quickFill = (u) => {
    setUsername(u);
    setPassword("demo123");
  };

  return (
    <div className="login-wrap">
      <img src={osfinLogo} alt="Osfin" className="page-logo" />
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div>
            <h1>Account Reconciliation</h1>
            <p>Sign in to continue</p>
          </div>
        </div>

        <label className="form-label">Username</label>
        <input
          className="form-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
        />

        <label className="form-label">Password</label>
        <input
          className="form-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {error ? <div className="alert error">{error}</div> : null}

        <button className="btn primary full" type="submit" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>

        <div className="login-help">
          <div className="muted small">Demo accounts (password <code>demo123</code>)</div>
          <div className="demo-chips">
            <button type="button" className="chip" onClick={() => quickFill("stacy")}>stacy · Admin</button>
            <button type="button" className="chip" onClick={() => quickFill("bob")}>bob · Preparer</button>
            <button type="button" className="chip" onClick={() => quickFill("edith")}>edith · Approver</button>
            <button type="button" className="chip" onClick={() => quickFill("sam")}>sam · Auditor</button>
          </div>
        </div>
      </form>
    </div>
  );
}
