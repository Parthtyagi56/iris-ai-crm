import { useEffect, useState } from "react";
import { wakeBackend } from "../api.js";

// Holds the app behind a calm splash until the backend responds. On Render's
// free tier the service sleeps after ~15 min idle and takes ~50s to wake, so
// the first visitor would otherwise hit a failed request. This makes that
// invisible: a brief flash when warm, a friendly "waking up" note when cold.
export default function BootGate({ children }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);

  function boot() {
    setFailed(false);
    setReady(false);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 3500);
    wakeBackend()
      .then((ok) => (ok ? setReady(true) : setFailed(true)))
      .finally(() => clearTimeout(slowTimer));
  }

  useEffect(boot, []);

  if (ready) return children;

  return (
    <div className="boot-screen">
      <div className="boot-card">
        <div className="boot-mark">Iris</div>
        {!failed ? (
          <>
            <div className="boot-spinner" aria-hidden="true" />
            <div className="boot-sub">Waking the workspace…</div>
            {slow && (
              <div className="boot-hint">
                The demo runs on a free tier that sleeps when idle, so the first
                load can take up to a minute while the server starts. Thanks for
                your patience.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="boot-sub">Couldn’t reach the server.</div>
            <div className="boot-hint">
              It may still be starting up. Give it a few seconds and try again.
            </div>
            <button className="boot-retry" onClick={boot}>
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}
