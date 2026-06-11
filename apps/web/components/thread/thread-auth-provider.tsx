"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ThreadAuthScreen } from "./thread-auth-screen";
import { useThreadUser } from "~/components/app/use-thread-user";

type AuthMode = "sign-in" | "sign-up";

type AuthContextValue = {
  isAuthOpen: boolean;
  openAuth: (mode?: AuthMode) => void;
  closeAuth: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useThreadAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useThreadAuth must be used within ThreadAuthProvider");
  return ctx;
}

function ThreadAuthProviderInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading } = useThreadUser();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const errorMessage = searchParams.get("error") ?? undefined;

  useEffect(() => {
    if (isLoading) return;
    if (user) {
      if (searchParams.get("hero") === "1" || searchParams.get("login") === "1") {
        router.replace("/inbox");
      }
      return;
    }
    if (searchParams.get("login") === "1") setOpen(true);
  }, [searchParams, user, isLoading, router]);

  const openAuth = useCallback((nextMode: AuthMode = "sign-in") => {
    setMode(nextMode);
    setOpen(true);
    window.scrollTo(0, 0);
  }, []);

  const closeAuth = useCallback(() => {
    setOpen(false);
    if (typeof window !== "undefined" && window.location.search) {
      const url = new URL(window.location.href);
      if (url.searchParams.has("error") || url.searchParams.has("login")) {
        url.searchParams.delete("error");
        url.searchParams.delete("login");
        const next = url.pathname + (url.search || "") + url.hash;
        window.history.replaceState({}, "", next);
      }
    }
  }, []);

  const value = useMemo(
    () => ({ isAuthOpen: open, openAuth, closeAuth }),
    [open, openAuth, closeAuth],
  );

  if (open) {
    return (
      <AuthContext.Provider value={value}>
        <ThreadAuthScreen mode={mode} errorMessage={errorMessage} onClose={closeAuth} />
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function ThreadAuthProvider({ children }: { children: ReactNode }) {
  return <ThreadAuthProviderInner>{children}</ThreadAuthProviderInner>;
}
