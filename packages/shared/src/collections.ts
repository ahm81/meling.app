// Firestore paths. Keep in sync with docs/datamodel.md and MelingCore/Collections.swift.
export const Collections = {
  users: "users",
  families: "families",
  members: "members",
} as const;

export const paths = {
  user: (uid: string) => `${Collections.users}/${uid}`,
  family: (familyId: string) => `${Collections.families}/${familyId}`,
  member: (familyId: string, uid: string) =>
    `${Collections.families}/${familyId}/${Collections.members}/${uid}`,
};
