import { z } from "zod";

// meling.app is for one family only. A signed-in user has access if and only if
// members/{uid} exists. Members are added by an admin (pnpm add-member), never by clients.

export const MemberRole = z.enum(["adult", "child"]);
export type MemberRole = z.infer<typeof MemberRole>;

export const MemberDoc = z.object({
  displayName: z.string().min(1).max(80),
  email: z.email(),
  role: MemberRole,
});
export type MemberDoc = z.infer<typeof MemberDoc>;
