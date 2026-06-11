import type { ReactNode } from "react";
import "~/components/thread/thread.css";
import "~/components/app/thread-app.css";
import { ThreadAppShell } from "~/components/app/thread-app-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <ThreadAppShell>{children}</ThreadAppShell>;
}
