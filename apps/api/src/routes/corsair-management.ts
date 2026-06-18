import { Router } from "express";
import { toExpressHandler } from "corsair";

import { getCorsair, isCorsairConfigured } from "../corsair";

export const corsairManagementRouter = Router();

corsairManagementRouter.use((req, res, next) => {
  if (!isCorsairConfigured()) {
    return res.status(503).json({ error: "Corsair is not configured" });
  }
  const handler = toExpressHandler(getCorsair(), { basePath: "/api/corsair" });
  void handler(req, res, next).catch(next);
});
