import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Thread",
  description: "How Thread handles your data.",
};

export default function PrivacyPage() {
  return (
    <main className="thread-privacy">
      <Link href="/" className="thread-privacy-back">
        ← Back to Thread
      </Link>

      <h1 className="thread-privacy-title">Privacy Policy</h1>
      <p className="thread-privacy-updated">Last updated: October 2026</p>

      <Section title="Overview">
        Thread (&quot;the app&quot;) is an AI-powered Chief of Staff for Gmail, Google Calendar and
        Google Workspace, available as a web app and as the Thread Chrome extension (Captain
        Thread and the Meet copilot). We are committed to protecting your privacy. This policy
        explains what data we access, how we use it, and how it is stored — for the web app and
        for the extension.
      </Section>

      <Section title="Data We Access">
        <p>When you connect your Google account, Thread requests access to:</p>
        <ul>
          <li>
            <strong>Gmail</strong> — to read, send, and manage your email threads on your behalf.
          </li>
          <li>
            <strong>Google Calendar</strong> — to view, create, and update calendar events on your
            behalf.
          </li>
        </ul>
        <p>
          These permissions are granted via Google OAuth 2.0 and can be revoked at any time from
          your{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            Google Account settings
          </a>
          .
        </p>
      </Section>

      <Section title="How We Use Your Data">
        <ul>
          <li>To generate your AI Daily Brief and smart context summaries.</li>
          <li>To suggest replies, meeting prep notes, and follow-up reminders.</li>
          <li>To display your inbox and calendar within the app.</li>
          <li>To queue and approve email and calendar actions on your behalf.</li>
        </ul>
        <p>
          We do <strong>not</strong> sell, share, or use your email or calendar data for advertising
          purposes.
        </p>
      </Section>

      <Section title="Chrome Extension — Captain Thread & Meet Copilot">
        <p>
          The Thread Chrome extension adds two features on top of the web app: Captain Thread (an
          on-page assistant) and a Google Meet copilot (live notes and transcription). Here is
          exactly what each one reads and sends.
        </p>
        <p>
          <strong>Captain Thread</strong> runs on the pages you visit so it can respond when you
          select text, draw around part of a page, or open it from the right-click menu.
        </p>
        <ul>
          <li>
            It only reads page content when you take one of those actions — it does not
            continuously scan or log the pages you browse.
          </li>
          <li>
            The selected or circled text, and the page&apos;s URL and title, are sent to the Thread
            API to generate an answer. No screenshots are taken; drawing a shape reads the text
            underneath it from the page, not a captured image.
          </li>
          <li>Page content is never used to train any AI model.</li>
        </ul>
        <p>
          <strong>Meet copilot</strong> only activates on meet.google.com, and only once you
          choose to start or join a call with Thread listening in.
        </p>
        <ul>
          <li>
            With your permission, it captures the call&apos;s audio (via the Chrome tab-capture
            permission) and your microphone, and sends short voice clips to{" "}
            <a href="https://docs.gnani.ai" target="_blank" rel="noreferrer">
              Gnani
            </a>{" "}
            for live, multilingual transcription.
          </li>
          <li>
            Transcripts are stored against your Thread account so the agent and meeting notes can
            use them later — the same way a meeting recorded through the web app is stored.
          </li>
          <li>Thread never joins or records a Meet call without you starting it from the extension.</li>
        </ul>
        <p>
          <strong>Voice features</strong> (voice typing, read aloud, translate and listen, and
          Catch me up) only run when you start them — with the keyboard shortcut, the right-click
          menu, or a button.
        </p>
        <ul>
          <li>
            Voice typing records your microphone only while it is switched on, sends short clips
            to Gnani to turn them into text, and types the result into the box you chose. It
            refuses password, card-number and one-time-code fields. It stops by itself after a
            minute of silence, when you press Esc, or when you leave the page. Audio is not
            stored.
          </li>
          <li>
            Read aloud and translate and listen send the text you selected (or the page text you
            asked to hear) to Thread, which translates it if needed and has Gnani speak it. The
            text is not kept after the request, apart from a short-lived in-memory cache so the
            same sentence is not processed twice.
          </li>
          <li>
            Catch me up summarises the recent part of the live transcript of a meeting you are in
            and reads it to you in the language you pick.
          </li>
        </ul>
        <p>
          <strong>Dubbing and your voice.</strong> Dubbing in Thread Meetings changes audio only,
          never the video, and only when you turn it on. Hearing a call translated, or speaking in
          another language, are separate switches you control. Saving a meeting&apos;s audio so it
          can be dubbed after the call is optional, and saved audio is deleted automatically after
          48 hours or when you delete the meeting. Thread creates a copy of your voice (through
          ElevenLabs) only from a sample you record yourself, uses it only for your own lines, and
          you can delete it at any time from the Meetings page. Other speakers are never cloned;
          they are given a standard Gnani voice.
        </p>
        <p>
          <strong>What stays on your device:</strong> the extension stores your sign-in token and a
          few preferences (like whether Captain Thread is on for a site) in Chrome&apos;s local
          extension storage, set to be unreadable by web pages. This never leaves your browser
          except as part of authenticated requests to the Thread API.
        </p>
      </Section>

      <Section title="Data Storage">
        <p>
          Thread caches a limited snapshot of your recent threads and events in a secure database to
          provide fast, offline-capable views. This cache is tied to your account and deleted when
          you disconnect your Google account.
        </p>
        <p>
          AI processing (summaries, suggestions) is performed via the OpenAI API. Email content
          sent to OpenAI is used solely to generate responses for you and is not retained by OpenAI
          beyond the API request per their{" "}
          <a
            href="https://openai.com/policies/api-data-usage-policies"
            target="_blank"
            rel="noreferrer"
          >
            API data usage policy
          </a>
          .
        </p>
      </Section>

      <Section title="Third-Party Services">
        <ul>
          <li>
            <strong>Google APIs</strong> — Gmail, Calendar, Drive, Docs, Sheets, Meet, Forms,
            Slides and Classroom access via OAuth 2.0, only for the apps you connect.
          </li>
          <li>
            <strong>OpenAI</strong> — AI summaries, replies and the Thread agent.
          </li>
          <li>
            <strong>Gnani</strong> — live, multilingual speech-to-text for Meet calls, voice typing
            and voice input, and text-to-speech for read aloud, translate and listen, catch-up and
            dubbing. Used only when you record, speak or ask to hear something.
          </li>
          <li>
            <strong>ElevenLabs</strong> — speaks your own lines in your own cloned voice when you
            have created one, and times dubbed audio. Not used unless you opt in to My voice
            dubbing.
          </li>
          <li>
            <strong>Vercel</strong> and <strong>Render</strong> — hosting and deployment for the
            web app and API.
          </li>
        </ul>
      </Section>

      <Section title="Your Rights">
        <p>You may at any time:</p>
        <ul>
          <li>Disconnect your Google account from the Settings page.</li>
          <li>
            Turn off Captain Thread for any site, or uninstall the Chrome extension entirely, from{" "}
            <code>chrome://extensions</code> — this immediately stops all page reading and Meet
            capture.
          </li>
          <li>Request deletion of your cached data and meeting transcripts by contacting us.</li>
          <li>
            Revoke Google permissions from{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              myaccount.google.com/permissions
            </a>
            .
          </li>
        </ul>
      </Section>

      <Section title="Contact">
        <p>
          For any privacy-related questions, please contact us at{" "}
          <a href="mailto:ishaansatapathy09@gmail.com">ishaansatapathy09@gmail.com</a>.
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="thread-privacy-section">
      <h2>{title}</h2>
      <div className="thread-privacy-body">{children}</div>
    </section>
  );
}
