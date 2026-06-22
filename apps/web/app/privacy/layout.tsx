import type { ReactNode } from "react";

import "~/components/thread/thread.css";

export default function PrivacyLayout({ children }: { children: ReactNode }) {
  return <div className="thread-page thread-privacy-shell">{children}</div>;
}
