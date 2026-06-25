/**
 * Realistic demo workspace data — seeded into Postgres (mail cache + queue).
 * Same paths as production: Brief gather, Agent list_inbox/get_thread, Inbox UI.
 */

export type DemoMailFixture = {
  threadId: string;
  subject: string;
  fromName: string;
  fromAddress: string;
  /** Full message body stored in mail cache snippet column. */
  body: string;
  unread: boolean;
  hoursAgo: number;
  starred?: boolean;
};

export type DemoQueueFixture = {
  kind: "email_send" | "email_draft" | "calendar_invite";
  title: string;
  preview: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "dismissed";
};

export const DEMO_MAIL_FIXTURES: DemoMailFixture[] = [
  {
    threadId: "demo-thread-investor",
    subject: "Re: Series A term sheet — need your input by EOD Friday",
    fromName: "Sarah Chen",
    fromAddress: "sarah@venture.co",
    body: `Hi,

Following up on our term sheet discussion from Tuesday's call.

We need your confirmation on three items before legal can finalize:
1. Valuation cap at $12M
2. Pro-rata rights for existing investors
3. Board observer seat for Horizon Ventures

Can you reply before EOD Friday? If easier, I can jump on a 15-minute call tomorrow morning.

Best,
Sarah Chen
Partner, Horizon Ventures`,
    unread: true,
    hoursAgo: 2,
    starred: true,
  },
  {
    threadId: "demo-thread-vendor-invoice",
    subject: "Invoice #8842 — payment due March 28",
    fromName: "Accounts Payable",
    fromAddress: "billing@cloudstack.io",
    body: `Hello,

Invoice #8842 for Q1 infrastructure ($4,280) is due March 28.

Line items:
- Production hosting: $2,900
- Staging environment: $980
- Support plan: $400

Please confirm payment date or flag any disputes by March 25.

Thanks,
CloudStack Accounts`,
    unread: true,
    hoursAgo: 4,
  },
  {
    threadId: "demo-thread-client-contract",
    subject: "Contract renewal — signature needed by April 1",
    fromName: "Michael Torres",
    fromAddress: "michael@acmecorp.com",
    body: `Hi,

Our enterprise agreement expires April 1. Legal sent the renewal draft — main changes are:
- Seat count 50 → 75
- SLA uptime 99.5% → 99.9%
- Annual prepay discount 8%

Can you review and sign this week? Happy to loop in your counsel.

Michael`,
    unread: true,
    hoursAgo: 5,
  },
  {
    threadId: "demo-thread-hiring",
    subject: "Offer letter — Alex Kim (Senior Engineer)",
    fromName: "People Ops",
    fromAddress: "hr@thread.dev",
    body: `Hi,

Alex Kim accepted verbally. Offer letter is attached in Drive — start date April 7.

Action needed: approve compensation band and send official offer by tomorrow so we don't lose them to the competing offer.

— People Ops`,
    unread: true,
    hoursAgo: 6,
  },
  {
    threadId: "demo-thread-meeting-prep",
    subject: "Tomorrow 11am — Corsair hackathon judge walkthrough",
    fromName: "Ishaan",
    fromAddress: "demo@thread.dev",
    body: `Reminder for tomorrow's session:

Agenda (30 min):
- Daily Brief + Needs attention flow
- Agent → queue_email demo
- Queue approve (HITL)
- Calendar quick-add

Prep: seed data refreshed, demo login tested, OPENAI_API_KEY set.`,
    unread: true,
    hoursAgo: 8,
  },
  {
    threadId: "demo-thread-followup",
    subject: "Re: Partnership intro — still waiting on your reply",
    fromName: "Alex Rivera",
    fromAddress: "alex@partner.io",
    body: `Hey,

Circling back on the partnership intro from last week. Our BD team is ready to move — just need your thumbs up on the pilot scope.

Can you send a quick reply today?

Alex`,
    unread: true,
    hoursAgo: 12,
  },
  {
    threadId: "demo-thread-security",
    subject: "Action required: SOC 2 auditor questions",
    fromName: "Compliance",
    fromAddress: "compliance@thread.dev",
    body: `Team,

Auditor sent 12 follow-up questions on access controls and data retention. Due Wednesday.

Most urgent: document our human-in-the-loop approval flow for outbound email and calendar actions.

Please assign an owner in today's standup.`,
    unread: true,
    hoursAgo: 18,
  },
  {
    threadId: "demo-thread-team-sync",
    subject: "Notes from product sync — ship queue UX polish",
    fromName: "Product",
    fromAddress: "product@thread.dev",
    body: `Notes from today's sync:

Decisions:
- Queue card shows payload preview before approve
- Demo mode uses seeded Postgres data, not hardcoded UI

Next: judge walkthrough script in DEMO.md

No reply needed — FYI.`,
    unread: false,
    hoursAgo: 22,
  },
  {
    threadId: "demo-thread-calendar-conflict",
    subject: "Conflict: Investor call overlaps with team review",
    fromName: "Calendar",
    fromAddress: "calendar@thread.dev",
    body: `Heads up — you have two events tomorrow 2–3pm:
- Investor update (Sarah Chen)
- Product review (internal)

Suggest moving product review to 4pm or declining one invite.`,
    unread: true,
    hoursAgo: 26,
  },
  {
    threadId: "demo-thread-support",
    subject: "Re: Thread demo login not working",
    fromName: "Support",
    fromAddress: "support@thread.dev",
    body: `Hi,

For demo login issues:
1. Run pnpm db:seed after migrations
2. Set DEMO_LOGIN_ENABLED=true
3. Hit /api-auth/demo?next=/brief

Let us know if seed data looks stale.`,
    unread: false,
    hoursAgo: 48,
  },
  {
    threadId: "demo-thread-nda",
    subject: "NDA countersigned — attach to data room",
    fromName: "Legal",
    fromAddress: "legal@thread.dev",
    body: `NDA with Horizon Ventures is fully executed. PDF in legal drive.

Please attach to the data room folder before Sarah's diligence call.`,
    unread: false,
    hoursAgo: 52,
  },
  {
    threadId: "demo-thread-queue-reminder",
    subject: "You have 3 items waiting in approval queue",
    fromName: "Thread",
    fromAddress: "queue@thread.dev",
    body: `Pending in /queue:
1. Send follow-up to Sarah (term sheet)
2. Calendar invite: Judge walkthrough dry run
3. Draft: Vendor payment confirmation

Nothing sends until you approve.`,
    unread: true,
    hoursAgo: 3,
  },
];

export function buildDemoQueueFixtures(): DemoQueueFixture[] {
  const tomorrow = new Date(Date.now() + 86_400_000);
  const dayAfter = new Date(tomorrow.getTime() + 3_600_000);
  const judgeSlot = new Date();
  judgeSlot.setDate(judgeSlot.getDate() + 1);
  judgeSlot.setHours(11, 0, 0, 0);
  const judgeEnd = new Date(judgeSlot.getTime() + 3_600_000);

  return [
    {
      kind: "email_send",
      title: "Send: Reply to Sarah — term sheet",
      preview: "Confirm valuation cap and pro-rata by EOD Friday",
      payload: {
        to: "sarah@venture.co",
        subject: "Re: Series A term sheet — need your input by EOD Friday",
        body: "Hi Sarah,\n\nThanks for the follow-up. I can confirm the $12M cap and pro-rata terms. Let's schedule 15 minutes tomorrow to finalize the board observer language.\n\nBest,",
      },
      status: "pending",
    },
    {
      kind: "calendar_invite",
      title: "Invite: Judge walkthrough dry run",
      preview: `${judgeSlot.toISOString()} → ${judgeEnd.toISOString()}`,
      payload: {
        summary: "Judge walkthrough dry run",
        description: "Brief → Agent → Queue → Calendar demo script",
        startDateTime: judgeSlot.toISOString(),
        endDateTime: judgeEnd.toISOString(),
        timeZone: "UTC",
      },
      status: "pending",
    },
    {
      kind: "email_draft",
      title: "Draft: Vendor payment confirmation",
      preview: "Confirm CloudStack invoice #8842 payment on March 27",
      payload: {
        to: "billing@cloudstack.io",
        subject: "Re: Invoice #8842 — payment due March 28",
        body: "Hi,\n\nPayment for invoice #8842 is scheduled for March 27. No disputes on line items.\n\nThanks,",
      },
      status: "pending",
    },
    {
      kind: "email_send",
      title: "Send: Welcome to Thread demo",
      preview: "Sample queued email for analytics",
      payload: {
        to: "guest@example.com",
        subject: "Welcome to Thread demo",
        body: "Hi — this sample queue item shows how approval works before Gmail sends.",
      },
      status: "pending",
    },
    {
      kind: "calendar_invite",
      title: "Invite: Demo sync (approved example)",
      preview: `${tomorrow.toISOString()} → ${dayAfter.toISOString()}`,
      payload: {
        summary: "Demo sync",
        description: "Previously approved sample item",
        startDateTime: tomorrow.toISOString(),
        endDateTime: dayAfter.toISOString(),
        timeZone: "UTC",
      },
      status: "approved",
    },
    {
      kind: "email_draft",
      title: "Draft: Follow-up note (dismissed example)",
      preview: "Dismissed sample for analytics",
      payload: {
        to: "you@example.com",
        subject: "Follow-up note",
        body: "Thanks for trying Thread.",
      },
      status: "dismissed",
    },
  ];
}
