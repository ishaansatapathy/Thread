import "./thread.css";
import { ThreadNav } from "./thread-nav";
import { ThreadHero } from "./thread-hero";
import { ThreadProcess } from "./thread-process";
import { ThreadRotator } from "./thread-rotator";
import { ThreadShowcase } from "./thread-showcase";
import {
  ThreadAgent,
  ThreadCta,
  ThreadFaq,
  ThreadFooter,
  ThreadIntegrations,
  ThreadCapabilities,
  ThreadMarquee,
  ThreadWorkflows,
} from "./thread-sections";

export function ThreadLanding() {
  return (
    <div className="thread-page">
      <ThreadNav />
      <main>
        <ThreadHero />
        <ThreadMarquee />
        <ThreadProcess />
        <ThreadIntegrations />
        <ThreadShowcase />
        <ThreadWorkflows />
        <ThreadRotator />
        <ThreadCapabilities />
        <ThreadAgent />
        <ThreadFaq />
        <ThreadCta />
      </main>
      <ThreadFooter />
    </div>
  );
}
