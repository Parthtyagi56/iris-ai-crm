import { useEffect, useRef, useState } from "react";
import { wakeBackend } from "../api.js";

// Holds the app behind a calm splash until the backend responds. On Render's
// free tier the service sleeps after ~15 min idle and takes ~50s to wake, so
// the first visitor would otherwise hit a failed request.
//
// It never traps anyone: after a short wait it offers Retry and "Open anyway",
// and flags that a privacy shield / ad-blocker (e.g. Brave Shields) may be
// blocking the API — which is the usual cause when it works elsewhere but not
// in one browser.
export default function BootGate({ children }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const cancelled = useRef(false);

  function boot() {
    setFailed(false);
    setReady(false);
    setAttempts(0);
    cancelled.current = false;
    wakeBackend({ onAttempt: (n) => !cancelled.current && setAttempts(n) }).then(
      (ok) => {
        if (cancelled.current) return;
        if (ok) setReady(true);
        else setFailed(true);
      }
    );
  }

  useEffect(() => {
    boot();
    return () => {
      cancelled.current = true;
    };
  }, []);

  if (ready) return children;

  const slow = attempts >= 2; // ~5s
  const stuck = attempts >= 6; // ~15s of failed pings (likely blocked)
  const openAnyway = () => {
    cancelled.current = true;
    setReady(true);
  };

  return (
    <div className="boot-screen">
      <div className="boot-card">
        <div className="boot-mark">Iris</div>

        {!failed && <div className="boot-spinner" aria-hidden="true" />}
        <div className="boot-sub">
          {failed ? "Couldn’t reach the server." : "Waking the workspace…"}
        </div>

        {!failed && slow && !stuck && (
          <div className="boot-hint">
            The demo runs on a free tier that sleeps when idle, so the first load
            can take up to a minute while the server starts.
          </div>
        )}

        {(stuck || failed) && (
          <>
            <div className="boot-hint">
              Taking longer than usual. If you’re on <b>Brave</b> or using an
              ad-blocker, its shield may be blocking the API for this site — try
              turning Shields <b>off</b> for this page, then Retry.
            </div>
            <div className="boot-actions">
              <button className="boot-retry" onClick={boot}>Retry</button>
              <button className="boot-link" onClick={openAnyway}>Open anyway</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
