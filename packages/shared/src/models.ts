import { z } from "zod";

// Timestamps are stored as Firestore Timestamps; on the wire (callable functions)
// they are ISO strings. Schemas here describe the document shape without timestamps
// so they can be shared by web, functions and tests.

export const MemberRole = z.enum(["parent", "child"]);
export type MemberRole = z.infer<typeof MemberRole>;

export const UserDoc = z.object({
  displayName: z.string().min(1).max(80),
  email: z.email().optional(),
  familyIds: z.array(z.string()).default([]),
});
export type UserDoc = z.infer<typeof UserDoc>;

export const FamilyDoc = z.object({
  name: z.string().min(1).max(80),
  ownerId: z.string(),
  memberIds: z.array(z.string()).min(1),
});
export type FamilyDoc = z.infer<typeof FamilyDoc>;

export const MemberDoc = z.object({
  displayName: z.string().min(1).max(80),
  role: MemberRole,
});
export type MemberDoc = z.infer<typeof MemberDoc>;

// Callable: createFamily
export const CreateFamilyRequest = z.object({
  name: FamilyDoc.shape.name,
  displayName: MemberDoc.shape.displayName,
});
export type CreateFamilyRequest = z.infer<typeof CreateFamilyRequest>;

export const CreateFamilyResponse = z.object({
  familyId: z.string(),
});
export type CreateFamilyResponse = z.infer<typeof CreateFamilyResponse>;
