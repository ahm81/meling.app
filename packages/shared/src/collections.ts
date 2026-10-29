// Firestore paths. Keep in sync with docs/datamodel.md and MelingCore/Collections.swift.
export const Collections = {
  members: "members",
} as const;

export const paths = {
  member: (uid: string) => `${Collections.members}/${uid}`,
};
