import { router } from "./trpc";

import { healthRouter } from "./routes/health/route";
import { authRouter } from "./routes/auth/route";
import { inboxRouter } from "./routes/inbox/route";

export const serverRouter = router({
  health: healthRouter,
  auth: authRouter,
  inbox: inboxRouter,
});

export const openApiRouter = serverRouter;

export { createContext } from "./context";
export type ServerRouter = typeof serverRouter;
