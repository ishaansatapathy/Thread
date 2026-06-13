import { eq } from "@repo/database";
import db from "@repo/database";
import { usersTable } from "@repo/database/schema";
import type { ApprovalDefaults, SettingsService } from "@repo/services/settings";

export class DbSettingsService implements SettingsService {
  async getApprovalDefaults(userId: string): Promise<ApprovalDefaults> {
    const [user] = await db
      .select({
        autoApproveEmail: usersTable.autoApproveEmail,
        autoApproveAgentEmail: usersTable.autoApproveAgentEmail,
        autoApproveCalendar: usersTable.autoApproveCalendar,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    return {
      autoApproveEmail: user?.autoApproveEmail ?? false,
      autoApproveAgentEmail: user?.autoApproveAgentEmail ?? false,
      autoApproveCalendar: user?.autoApproveCalendar ?? false,
    };
  }

  async updateApprovalDefaults(userId: string, input: ApprovalDefaults): Promise<ApprovalDefaults> {
    const [updated] = await db
      .update(usersTable)
      .set({
        autoApproveEmail: input.autoApproveEmail,
        autoApproveAgentEmail: input.autoApproveAgentEmail,
        autoApproveCalendar: input.autoApproveCalendar,
      })
      .where(eq(usersTable.id, userId))
      .returning({
        autoApproveEmail: usersTable.autoApproveEmail,
        autoApproveAgentEmail: usersTable.autoApproveAgentEmail,
        autoApproveCalendar: usersTable.autoApproveCalendar,
      });

    if (!updated) {
      throw new Error("User not found");
    }

    return {
      autoApproveEmail: updated.autoApproveEmail,
      autoApproveAgentEmail: updated.autoApproveAgentEmail,
      autoApproveCalendar: updated.autoApproveCalendar,
    };
  }
}
