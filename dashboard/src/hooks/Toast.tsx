import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';

const Ctx = createContext<(message: string) => void>(() => {});

/** A single polite toast ("Link copied"), announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((text: string) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2200);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-[3000] flex justify-center px-4" data-no-print>
        {message && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-md bg-text px-3 py-2 text-sm font-medium text-surface shadow-3">
            <Check aria-hidden="true" className="h-4 w-4" />
            {message}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
