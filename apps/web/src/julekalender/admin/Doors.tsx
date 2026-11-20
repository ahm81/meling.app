import type { ReactNode } from "react";
import { DOOR_COUNT, type Theme } from "@meling/shared";

export const DAYS = Array.from({ length: DOOR_COUNT }, (_, i) => i + 1);

export const THEME_LABELS: Record<Theme, string> = {
  jul: "Jul",
  vinter: "Vinter",
  skog: "Skog",
  natt: "Natt",
};

/** What a door looks like: its picture if it has one, else the theme's colour. Goes on the door element. */
export function doorFace(url: string | null | undefined): {
  className: string;
  style?: { backgroundImage: string };
} {
  return url
    ? {
        className: "door has-image",
        style: { backgroundImage: `url("${url}")` },
      }
    : { className: "door" };
}

/** The child's calendar in a phone-wide frame with the calendar's theme. */
export function ChildFrame({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <div className="child-frame" data-theme={theme}>
      {children}
    </div>
  );
}
