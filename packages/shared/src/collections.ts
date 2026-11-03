// Firestore paths. Keep in sync with docs/datamodel.md and MelingCore/Collections.swift.
export const Collections = {
  members: "members",
  julekalender: "julekalender",
} as const;

export const paths = {
  member: (uid: string) => `${Collections.members}/${uid}`,
  calendar: (calId: string) => `${Collections.julekalender}/${calId}`,
  manual: (calId: string, manualId: string) =>
    `${Collections.julekalender}/${calId}/manuals/${manualId}`,
  page: (calId: string, manualId: string, page: number) =>
    `${Collections.julekalender}/${calId}/pages/${manualId}_${page}`,
  version: (calId: string, n: number) =>
    `${Collections.julekalender}/${calId}/versions/${String(n).padStart(6, "0")}`,
};

// Cloud Storage paths for the julekalender.
export const storagePaths = {
  manualPdf: (calId: string, manualId: string) =>
    `${Collections.julekalender}/${calId}/manuals/${manualId}.pdf`,
  pageImage: (calId: string, manualId: string, page: number) =>
    `${Collections.julekalender}/${calId}/pages/${manualId}/${page}.png`,
  cutout: (calId: string, stepId: string, maskKey: string) =>
    `${Collections.julekalender}/${calId}/cutouts/${stepId}/${maskKey}.webp`,
  // Folder prefixes (with trailing slash) for deleting a manual's derived files.
  pagesDir: (calId: string, manualId: string) =>
    `${Collections.julekalender}/${calId}/pages/${manualId}/`,
  cutoutsDir: (calId: string) => `${Collections.julekalender}/${calId}/cutouts/`,
};
