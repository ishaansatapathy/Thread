import "./thread.css";
import "./landing/landing.css";
import { ThreadNav } from "./thread-nav";
import { LpSmoothScroll } from "./landing/lp-smooth-scroll";
import { LpHero } from "./landing/lp-hero";
import { LpCarousel } from "./landing/lp-carousel";
import { LpStack } from "./landing/lp-stack";
import { LpFlow } from "./landing/lp-flow";
import { ThreadAgent, ThreadCta, ThreadFaq, ThreadFooter } from "./thread-sections";

export function ThreadLanding() {
  return (
    <div className="thread-page lp-page">
      <LpSmoothScroll />
      <ThreadNav />
      <main>
        <LpHero />
        <LpCarousel />
        <LpStack />
        <LpFlow />
        <ThreadAgent />
        <ThreadFaq />
        <ThreadCta />
      </main>
      <ThreadFooter />
    </div>
  );
}
