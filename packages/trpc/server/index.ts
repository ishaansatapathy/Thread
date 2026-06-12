import { router } from "./trpc";

import { healthRouter } from "./routes/health/route";
import { authRouter } from "./routes/auth/route";
import { inboxRouter } from "./routes/inbox/route";
import { calendarRouter } from "./routes/calendar/route";
import { queueRouter } from "./routes/queue/route";
import { aiRouter } from "./routes/ai/route";

export const serverRouter = router({
  health: healthRouter,
  auth: authRouter,
  inbox: inboxRouter,
  calendar: calendarRouter,
  queue: queueRouter,
  ai: aiRouter,
});

export const openApiRouter = serverRouter;

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
