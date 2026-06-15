import { z } from "zod";

import { dailyBriefSchema, generateDailyBrief } from "@repo/services/ai";

import { mapServiceError, protectedProcedure, router } from "../../trpc";
import { generatePath } from "../../utils/path-generator";

const TAGS = ["Brief"];
const getPath = generatePath("/brief");

export const briefRouter = router({
  get: protectedProcedure
    .meta({ openapi: { method: "GET", path: getPath("/"), tags: TAGS } })
    .input(
      z.object({
        timeZone: z.string().max(64).optional(),
      }),
    )
    .output(dailyBriefSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await generateDailyBrief({
          tenantId: ctx.user.id,
          userEmail: ctx.user.email,
          displayName: ctx.user.displayName ?? ctx.user.fullName,
          timeZone: input.timeZone,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
