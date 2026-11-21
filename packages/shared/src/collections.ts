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
  // The picture of a brick from the parts list, one per element id in the calendar.
  brickImage: (calId: string, elementId: string) =>
    `${Collections.julekalender}/${calId}/bricks/${elementId}.webp`,
  // The picture of one brick in a step's parts box, so an adult can check or correct its match. `index` is its
  // position in the page's `bricks.callouts`.
  calloutImage: (calId: string, manualId: string, page: number, index: number) =>
    `${Collections.julekalender}/${calId}/bricks/callouts/${manualId}/${page}_${index}.webp`,
  // The picture an adult has put on a door. `id` is new for every upload, so a replaced picture gets a new path
  // (and URL) instead of being served from a cache.
  doorImage: (calId: string, day: number, id: string) =>
    `${Collections.julekalender}/${calId}/doors/${day}_${id}.jpg`,
  // A door picture made by AI when an adult accepts a theme draft. `id` is new for every acceptance.
  aiDoorImage: (calId: string, day: number, id: string) =>
    `${Collections.julekalender}/${calId}/doors/${day}_ai${id}.jpg`,
  // Pictures of a theme draft, written by functions only. `id` is new for every draft.
  themeDraftStyle: (calId: string, id: string) =>
    `${Collections.julekalender}/${calId}/themeDraft/style_${id}.png`,
  themeDraftDoor: (calId: string, day: number, id: string) =>
    `${Collections.julekalender}/${calId}/themeDraft/${day}_${id}.jpg`,
  themeDraftDir: (calId: string) => `${Collections.julekalender}/${calId}/themeDraft/`,
  // Folder prefixes (with trailing slash) for deleting a manual's derived files.
  pagesDir: (calId: string, manualId: string) =>
    `${Collections.julekalender}/${calId}/pages/${manualId}/`,
  cutoutsDir: (calId: string) => `${Collections.julekalender}/${calId}/cutouts/`,
  bricksDir: (calId: string) => `${Collections.julekalender}/${calId}/bricks/`,
};

/** True for a door picture made by AI (see `storagePaths.aiDoorImage`), false for one an adult uploaded. */
export const isAiDoorImage = (path: string): boolean => /\/doors\/\d{1,2}_ai[A-Za-z0-9]+\.jpg$/.test(path);
