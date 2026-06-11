import { Suspense } from "react";
import { ThreadLanding } from "~/components/thread/thread-landing";
import { ThreadAuthProvider } from "~/components/thread/thread-auth-provider";

export default function Home() {
  return (
    <Suspense>
      <ThreadAuthProvider>
        <ThreadLanding />
      </ThreadAuthProvider>
    </Suspense>
  );
}
