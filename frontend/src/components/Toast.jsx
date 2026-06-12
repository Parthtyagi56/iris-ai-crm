import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, XCircle, Info } from "lucide-react";

const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  // toast("Saved", "success" | "error" | "info")
  const toast = useCallback((message, kind = "info") => {
    const id = nextId++;
    setToasts((ts) => [...ts, { id, message, kind }]);
    timers.current[id] = setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
            <span className="toast-icon">
              {t.kind === "success" ? <CheckCircle2 size={16} /> : t.kind === "error" ? <XCircle size={16} /> : <Info size={16} />}
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
