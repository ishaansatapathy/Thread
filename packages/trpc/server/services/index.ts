import AuthService from "@repo/services/auth";
import UserService from "@repo/services/user";

export const userService = new UserService();
export const authService = new AuthService();

export { invalidateBriefCache } from "../routes/ai/route";
