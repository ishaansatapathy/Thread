"use client";

import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Inbox, Send, ShieldCheck, Sparkles } from "lucide-react";
import { InViewAnnotation } from "./thread-reveal";
import { FlowDottedConnectors } from "./thread-flow-connectors";

const STEPS = [
  {
    icon: Inbox,
    title: "Email lands",
    desc: "New mail arrives through Corsair webhooks and gets cached in Postgres.",
  },
  {
    icon: Sparkles,
    title: "Thread scores it",
    desc: "An LLM ranks subject + body so the urgent stuff surfaces first.",
  },
  {
    icon: ShieldCheck,
    title: "You review",
    desc: "Draft reply and a calendar invite are queued — nothing sends without your OK.",
  },
  {
    icon: Send,
    title: "Sent in one step",
    desc: "Approve once: the reply ships and the invite hits Google Calendar.",
  },
];

/** Each stage reveals only when it scrolls into view — undo on scroll up. */
function useStageInView() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { threshold: 0.35, rootMargin: "0px 0px -22% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, visible };
}

export function ThreadProcess() {
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [boxVisible, setBoxVisible] = useState<boolean[]>(() => STEPS.map(() => false));
  const [edgeVisible, setEdgeVisible] = useState<boolean[]>(() =>
    STEPS.slice(0, -1).map(() => false),
  );

  const syncBox = useCallback((index: number, visible: boolean) => {
    setBoxVisible((prev) => {
      if (prev[index] === visible) return prev;
      const next = [...prev];
      next[index] = visible;
      return next;
    });
  }, []);

  const syncEdge = useCallback((index: number, visible: boolean) => {
    setEdgeVisible((prev) => {
      if (prev[index] === visible) return prev;
      const next = [...prev];
      next[index] = visible;
      return next;
    });
  }, []);

  const { ref: headRef, visible: headVisible } = useStageInView();
  const { ref: footRef, visible: footVisible } = useStageInView();

  const jumpToStep = useCallback((i: number) => {
    cardRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <section id="how" className="thread-shell thread-section">
      <div className="thread-frame">
        <div className="thread-process-head" ref={headRef}>
          <div className="thread-flow-reveal" data-visible={headVisible}>
            <span className="thread-eyebrow">How it works</span>
            <h2 className="thread-h2" style={{ marginTop: 16 }}>
              From inbox to invite in{" "}
              <InViewAnnotation type="underline" delay={350}>
                four steps
              </InViewAnnotation>
            </h2>
            <p className="thread-lede" style={{ maxWidth: 520 }}>
              Scroll — each box appears one by one, connected right → down → left → down.
            </p>

            <div className="thread-process-rail" role="tablist" aria-label="Process steps">
              {STEPS.map((step, i) => (
                <button
                  key={step.title}
                  type="button"
                  role="tab"
                  aria-selected={boxVisible[i] ?? false}
                  className="thread-process-pill"
                  data-active={boxVisible[i] ?? false}
                  onClick={() => jumpToStep(i)}
                >
                  <span className="thread-process-pill-dot" data-active={boxVisible[i] ?? false} />
                  <span style={{ fontFamily: "var(--thread-mono)", fontSize: 10, letterSpacing: "0.08em" }}>
                    0{i + 1}
                  </span>
                  {step.title}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="thread-flow-scroll">
          <FlowDottedConnectors
            cardRefs={cardRefs}
            edgeVisible={edgeVisible.map((edge, i) => edge && (boxVisible[i] ?? false))}
          />

          {STEPS.map((step, i) => {
            const align = i % 2 === 0 ? "left" : "right";

            return (
              <Fragment key={step.title}>
                <StageWatcher onChange={(v) => syncBox(i, v)}>
                  <div className={`thread-flow-row thread-flow-row--${align}`}>
                    <FlowStepCard
                      ref={(el) => {
                        cardRefs.current[i] = el;
                      }}
                      align={align}
                      index={i}
                      isLast={i === STEPS.length - 1}
                      visible={boxVisible[i] ?? false}
                      icon={<step.icon size={18} />}
                      num={`0${i + 1}`}
                      title={step.title}
                      desc={step.desc}
                    />
                  </div>
                </StageWatcher>

                {i < STEPS.length - 1 && (
                  <StageWatcher onChange={(v) => syncEdge(i, v)}>
                    <div className="thread-flow-edge-stage" aria-hidden />
                  </StageWatcher>
                )}
              </Fragment>
            );
          })}
        </div>

        <div className="thread-process-foot" ref={footRef}>
          <div className="thread-flow-reveal" data-visible={footVisible}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--thread-accent-bright)",
                  boxShadow: "0 0 10px var(--thread-accent-glow)",
                }}
              />
              Every step runs through{" "}
              <strong style={{ color: "var(--thread-text)", fontWeight: 600 }}>Corsair MCP</strong> — so an
              agent can drive the same flow in plain English.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Observes its wrapper and reports visibility upward. */
function StageWatcher({
  children,
  onChange,
}: {
  children: ReactNode;
  onChange: (visible: boolean) => void;
}) {
  const { ref, visible } = useStageInView();

  useEffect(() => {
    onChange(visible);
  }, [visible, onChange]);

  return <div ref={ref}>{children}</div>;
}

const FlowStepCard = forwardRef<
  HTMLDivElement,
  {
    align: "left" | "right";
    index: number;
    isLast: boolean;
    visible: boolean;
    icon: ReactNode;
    num: string;
    title: string;
    desc: string;
  }
>(function FlowStepCard({ align, index, isLast, visible, icon, num, title, desc }, ref) {
  return (
    <div className="thread-flow-reveal" data-visible={visible}>
      <div
        ref={ref}
        className={`thread-flow-step thread-flow-step--${align}`}
        data-connect={align}
      >
        {!isLast && <span className="thread-flow-anchor thread-flow-anchor--out" aria-hidden />}
        {index > 0 && <span className="thread-flow-anchor thread-flow-anchor--in" aria-hidden />}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="thread-flow-icon">{icon}</span>
          <span className="thread-flow-num">{num}</span>
        </div>
        <div className="thread-flow-title">{title}</div>
        <div className="thread-flow-desc">{desc}</div>
      </div>
    </div>
  );
});
