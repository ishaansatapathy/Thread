import { router } from "./trpc";

import { healthRouter } from "./routes/health/route";
import { authRouter } from "./routes/auth/route";
import { inboxRouter } from "./routes/inbox/route";
import { calendarRouter } from "./routes/calendar/route";
import { queueRouter } from "./routes/queue/route";
import { aiRouter } from "./routes/ai/route";
import { agentRouter } from "./routes/agent/route";
import { contactsRouter } from "./routes/contacts/route";
import { settingsRouter } from "./routes/settings/route";
import { observabilityRouter } from "./routes/observability/route";
import { briefRouter } from "./routes/brief/route";

export const serverRouter = router({
  health: healthRouter,
  auth: authRouter,
  inbox: inboxRouter,
  calendar: calendarRouter,
  queue: queueRouter,
  ai: aiRouter,
  agent: agentRouter,
  contacts: contactsRouter,
  settings: settingsRouter,
  observability: observabilityRouter,
  brief: briefRouter,
});

export const openApiRouter = serverRouter;

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
