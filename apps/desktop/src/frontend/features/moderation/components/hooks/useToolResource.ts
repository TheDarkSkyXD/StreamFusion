import { useEffect, useRef, useState } from "react";

export function useToolResource<T>(load: () => Promise<T>, refreshCounter = 0) {
  const [value, setValue] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void load()
      .then((next) => {
        if (current) setValue(next);
      })
      .catch((failure: unknown) => {
        if (current) setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [load, refreshCounter, revision]);
  const run = async (action: () => Promise<void>): Promise<boolean> => {
    if (pending.current || loading) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      if (active.current) setRevision((current) => current + 1);
      return true;
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };
  return { value, loading, error, busy, run, retry: () => setRevision((current) => current + 1) };
}
