"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Pack = { id: string; name: string; credits: number; amountPaise: number; blurb: string };
type Transaction = { id: string; kind: "grant" | "purchase" | "spend" | "refund"; delta: number; balanceAfter: number; note: string | null; createdAt: string };
type Summary = {
  balance: number;
  enforced: boolean;
  paymentsEnabled: boolean;
  isAdmin: boolean;
  packs: Pack[];
  costs: { agentMessage: number; speakPer1000Chars: number; translateSpeak: number; catchUp: number; dubPerMinute: number };
  transactions: Transaction[];
};
type Usage = {
  days: number;
  bySource: Array<{ source: string; events: number; users: number }>;
  byFeature: Array<{ feature: string; source: string; events: number; credits: number }>;
  topUsers: Array<{ email: string; events: number; extension_events: number }>;
};
type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayWindow = Window & { Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, cb: () => void) => void } };

const API_HEADERS = { "Content-Type": "application/json", "x-thread-csrf": "1" };
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

const FEATURE_LABEL: Record<string, string> = {
  agent_message: "Agent messages",
  speak: "Read aloud",
  translate_speak: "Translate & listen",
  catch_up: "Catch me up",
  dub: "Meeting dubbing",
  dictation: "Voice typing clips",
  live_dub: "Live dubbed lines",
};

function loadCheckout(): Promise<boolean> {
  if ((window as RazorpayWindow).Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function BillingPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api-billing", { credentials: "include" });
      const data = (await res.json()) as Summary & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not load your credits.");
      setSummary(data);
      setError(null);
      if (data.isAdmin) {
        const usageRes = await fetch("/api-billing/admin/usage?days=7", { credentials: "include" });
        if (usageRes.ok) setUsage((await usageRes.json()) as Usage);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your credits.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = async (pack: Pack) => {
    setBuying(pack.id);
    try {
      if (!(await loadCheckout())) throw new Error("Couldn't load the payment window. Check your connection.");
      const orderRes = await fetch("/api-billing/order", { method: "POST", credentials: "include", headers: API_HEADERS, body: JSON.stringify({ packId: pack.id }) });
      const order = (await orderRes.json()) as { orderId?: string; amount?: number; currency?: string; keyId?: string; error?: string };
      if (!orderRes.ok || !order.orderId) throw new Error(order.error ?? "Couldn't start the payment.");

      const checkout = new (window as RazorpayWindow).Razorpay!({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: "Thread",
        description: `${pack.name} · ${pack.credits} credits`,
        theme: { color: "#3b6cf6" },
        handler: async (response: RazorpayResponse) => {
          try {
            const verifyRes = await fetch("/api-billing/verify", {
              method: "POST",
              credentials: "include",
              headers: API_HEADERS,
              body: JSON.stringify({ orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }),
            });
            const verified = (await verifyRes.json()) as { balance?: number; error?: string };
            if (!verifyRes.ok) throw new Error(verified.error ?? "Payment could not be verified.");
            toast.success(`${pack.credits} credits added.`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Payment received — credits will appear shortly.");
          } finally {
            setBuying(null);
            void load();
          }
        },
        modal: { ondismiss: () => setBuying(null) },
      });
      checkout.on("payment.failed", () => toast.error("The payment didn't go through. You weren't charged."));
      checkout.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the payment.");
      setBuying(null);
    }
  };

  if (error) return <div className="thread-app-page"><div className="thread-credits"><p className="thread-credits-note">{error}</p></div></div>;
  if (!summary) return <div className="thread-app-page"><div className="thread-credits"><Loader2 className="thread-spin" size={18} /></div></div>;

  const { costs } = summary;
  return (
    <div className="thread-app-page">
      <div className="thread-credits">
        <section className="thread-credits-balance">
          <span className="thread-credits-icon"><Coins size={18} /></span>
          <div>
            <small>Your credits</small>
            <strong>{summary.balance.toLocaleString("en-IN")}</strong>
          </div>
          <p className="thread-credits-note">
            {summary.enforced
              ? "Credits are used as you go. They never expire."
              : "Credits aren't being charged yet, so everything is free right now. Usage is still counted."}
          </p>
        </section>

        <section>
          <h2 className="thread-credits-h">Add credits</h2>
          <div className="thread-credits-packs">
            {summary.packs.map((pack) => (
              <div key={pack.id} className="thread-credits-pack">
                <strong>{pack.name}</strong>
                <span className="thread-credits-pack-credits">{pack.credits.toLocaleString("en-IN")} credits</span>
                <span className="thread-credits-pack-price">{rupees(pack.amountPaise)}</span>
                <small>{pack.blurb}</small>
                <button type="button" className="thread-btn-accent" disabled={!summary.paymentsEnabled || buying !== null} onClick={() => void buy(pack)}>
                  {buying === pack.id ? <Loader2 size={14} className="thread-spin" /> : null}
                  {summary.paymentsEnabled ? "Buy" : "Coming soon"}
                </button>
              </div>
            ))}
          </div>
          <p className="thread-credits-note">Payments are handled by Razorpay (UPI, cards, netbanking). Thread never sees your card details.</p>
        </section>

        <section>
          <h2 className="thread-credits-h">What things cost</h2>
          <ul className="thread-credits-costs">
            <li><span>Agent message</span><b>{costs.agentMessage}</b></li>
            <li><span>Read aloud, per 1,000 characters</span><b>{costs.speakPer1000Chars}</b></li>
            <li><span>Translate &amp; listen</span><b>{costs.translateSpeak}</b></li>
            <li><span>Catch me up</span><b>{costs.catchUp}</b></li>
            <li><span>Meeting dubbing, per audio minute</span><b>{costs.dubPerMinute}</b></li>
            <li><span>Voice typing and live dubbed lines</span><b>free</b></li>
          </ul>
        </section>

        <section>
          <h2 className="thread-credits-h">History</h2>
          {summary.transactions.length === 0 ? (
            <p className="thread-credits-note">Nothing yet.</p>
          ) : (
            <ul className="thread-credits-history">
              {summary.transactions.map((t) => (
                <li key={t.id}>
                  <span>
                    {t.note ?? t.kind}
                    <small>{new Date(t.createdAt).toLocaleString()}</small>
                  </span>
                  <b data-positive={t.delta > 0 ? "true" : undefined}>{t.delta > 0 ? `+${t.delta}` : t.delta}</b>
                </li>
              ))}
            </ul>
          )}
        </section>

        {summary.isAdmin && usage ? (
          <section>
            <h2 className="thread-credits-h">Usage, last {usage.days} days (admin)</h2>
            <ul className="thread-credits-costs">
              {usage.bySource.map((row) => (
                <li key={row.source}>
                  <span>{row.source === "extension" ? "Chrome extension" : "Web app"} · {row.users} user{row.users === 1 ? "" : "s"}</span>
                  <b>{row.events}</b>
                </li>
              ))}
            </ul>
            <ul className="thread-credits-costs">
              {usage.byFeature.map((row) => (
                <li key={`${row.feature}-${row.source}`}>
                  <span>{FEATURE_LABEL[row.feature] ?? row.feature} · {row.source}</span>
                  <b>{row.events}</b>
                </li>
              ))}
            </ul>
            <ul className="thread-credits-costs">
              {usage.topUsers.map((row) => (
                <li key={row.email}>
                  <span>{row.email}</span>
                  <b>{row.events} ({row.extension_events} via extension)</b>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
