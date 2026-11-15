"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase/client";
import { FREE_UPLOADS, readAllowance, type Allowance } from "./pro";

export function useAllowance(refresh: number, disabled: boolean) {
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    if (disabled) return;
    let active = true;
    let run = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const supabase = getSupabase();
    async function load() {
      const current = ++run;
      try {
        const session = await supabase?.auth.getSession();
        if (!active || current !== run) return;
        if (session?.error) throw Error("session_unavailable");
        const token = session?.data.session?.access_token;
        if (!token) {
          const reset = new Date(); reset.setUTCHours(24, 0, 0, 0);
          setAllowance({ plan: "free", used: 0, limit: FREE_UPLOADS, remaining: FREE_UPLOADS, resetsAt: reset.toISOString() });
          setStatus("ready"); return;
        }
        const response = await fetch("/api/account", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        const next = response.ok && readAllowance(await response.json());
        if (!active || current !== run) return;
        if (!next) throw Error("allowance_unavailable");
        setAllowance(next); setStatus("ready");
      } catch {
        if (active && current === run) { setAllowance(null); setStatus("error"); }
      }
    }
    void load();
    const { data } = supabase?.auth.onAuthStateChange(() => {
      // Supabase session reads must happen after the auth callback releases its lock.
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 0);
    }) ?? { data: null };
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(() => void load(), 60_000);
    return () => {
      active = false; run++; clearTimeout(timer); clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible); data?.subscription.unsubscribe();
    };
  }, [refresh, disabled]);
  return { allowance, status };
}
