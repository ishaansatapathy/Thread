"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import "~/components/thread/thread.css";
import { ThreadAuthScreen } from "~/components/thread/thread-auth-screen";

function SignInContent() {
  const searchParams = useSearchParams();
  const errorMessage = searchParams.get("error") ?? undefined;
  const nextPath = searchParams.get("next") ?? undefined;
  const pendingTwoFactorEmail =
    searchParams.get("2fa") === "1" ? (searchParams.get("email") ?? undefined) : undefined;

  return (
    <ThreadAuthScreen
      errorMessage={errorMessage}
      nextPath={nextPath}
      pendingTwoFactorEmail={pendingTwoFactorEmail}
    />
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInContent />
    </Suspense>
  );
}
