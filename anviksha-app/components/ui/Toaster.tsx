"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, XCircle, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastType = "success" | "info" | "error";
type ToastItem = { id: number; message: string; type: ToastType };

const ToastContext = createContext<{ push: (message: string, type?: ToastType) => void }>({
  push: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToasterProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, type: ToastType = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3000);
  }, []);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  const icon = {
    success: <CheckCircle2 size={18} className="text-success shrink-0" />,
    info: <Info size={18} className="text-info shrink-0" />,
    error: <XCircle size={18} className="text-danger shrink-0" />,
  };

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed top-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.95, transition: { duration: 0.2 } }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
              className={cn(
                "pointer-events-auto flex items-center gap-2.5 rounded-xl bg-white/90 backdrop-blur-md shadow-cardHover border border-gray-100 px-4 py-3 min-w-[260px] max-w-sm"
              )}
            >
              {icon[t.type]}
              <span className="text-sm text-ink font-medium flex-1">{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="text-muted hover:text-ink">
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
