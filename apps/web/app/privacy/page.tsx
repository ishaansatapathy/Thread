import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Thread",
  description: "How Thread handles your data.",
};

export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "64px 24px",
        fontFamily: "system-ui, sans-serif",
        color: "#e5e7eb",
        lineHeight: 1.7,
      }}
    >
      <Link
        href="/"
        style={{
          fontSize: 13,
          color: "#6b7280",
          textDecoration: "none",
          display: "inline-block",
          marginBottom: 32,
        }}
      >
        ← Back to Thread
      </Link>

      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, color: "#f9fafb" }}>
        Privacy Policy
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 40 }}>
        Last updated: June 2026
      </p>

      <Section title="Overview">
        Thread (&quot;the app&quot;) is an AI-powered email and calendar management tool. We are
        committed to protecting your privacy. This policy explains what data we access, how we use
        it, and how it is stored.
      </Section>

      <Section title="Data We Access">
        <p>When you connect your Google account, Thread requests access to:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>
            <strong>Gmail</strong> — to read, send, and manage your email threads on your behalf.
          </li>
          <li>
            <strong>Google Calendar</strong> — to view, create, and update calendar events on your
            behalf.
          </li>
        </ul>
        <p style={{ marginTop: 12 }}>
          These permissions are granted via Google OAuth 2.0 and can be revoked at any time from
          your{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#60a5fa" }}
          >
            Google Account settings
          </a>
          .
        </p>
      </Section>

      <Section title="How We Use Your Data">
        <ul style={{ paddingLeft: 20 }}>
          <li>To generate your AI Daily Brief and smart context summaries.</li>
          <li>To suggest replies, meeting prep notes, and follow-up reminders.</li>
          <li>To display your inbox and calendar within the app.</li>
          <li>To queue and approve email and calendar actions on your behalf.</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          We do <strong>not</strong> sell, share, or use your email or calendar data for advertising
          purposes.
        </p>
      </Section>

      <Section title="Data Storage">
        <p>
          Thread caches a limited snapshot of your recent threads and events in a secure database to
          provide fast, offline-capable views. This cache is tied to your account and deleted when
          you disconnect your Google account.
        </p>
        <p style={{ marginTop: 8 }}>
          AI processing (summaries, suggestions) is performed via the OpenAI API. Email content
          sent to OpenAI is used solely to generate responses for you and is not retained by OpenAI
          beyond the API request per their{" "}
          <a
            href="https://openai.com/policies/api-data-usage-policies"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#60a5fa" }}
          >
            API data usage policy
          </a>
          .
        </p>
      </Section>

      <Section title="Third-Party Services">
        <ul style={{ paddingLeft: 20 }}>
          <li>
            <strong>Google APIs</strong> — Gmail and Calendar access via OAuth 2.0.
          </li>
          <li>
            <strong>OpenAI</strong> — AI summaries and suggestions.
          </li>
          <li>
            <strong>Vercel</strong> — Hosting and deployment.
          </li>
        </ul>
      </Section>

      <Section title="Your Rights">
        <p>You may at any time:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>Disconnect your Google account from the Settings page.</li>
          <li>Request deletion of your cached data by contacting us.</li>
          <li>
            Revoke Google permissions from{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#60a5fa" }}
            >
              myaccount.google.com/permissions
            </a>
            .
          </li>
        </ul>
      </Section>

      <Section title="Contact">
        <p>
          For any privacy-related questions, please contact us at{" "}
          <a href="mailto:privacy@thread-web.vercel.app" style={{ color: "#60a5fa" }}>
            privacy@thread-web.vercel.app
          </a>
          .
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: "#f3f4f6", marginBottom: 10 }}>
        {title}
      </h2>
      <div style={{ fontSize: 14.5, color: "#d1d5db" }}>{children}</div>
    </section>
  );
}
