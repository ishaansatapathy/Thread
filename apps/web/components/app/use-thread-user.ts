"use client";

import { trpc } from "~/trpc/client";

export function useThreadUser() {
  const query = trpc.auth.me.useQuery({}, {
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export function initials(name: string | null | undefined, email: string) {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "T";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
