import type { CSSProperties, ReactNode } from "react";
import { DOOR_COUNT, type Theme, type ThemeColors } from "@meling/shared";

export const DAYS = Array.from({ length: DOOR_COUNT }, (_, i) => i + 1);

export const THEME_LABELS: Record<Theme, string> = {
  jul: "Jul",
  vinter: "Vinter",
  skog: "Skog",
  natt: "Natt",
  egen: "Eget",
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

/** A custom theme's colours as the CSS variables the fixed themes set in index.css. */
export function themeVars(colors: ThemeColors): CSSProperties {
  return {
    "--c-bg": colors.bg,
    "--c-door": colors.door,
    "--c-done": colors.done,
    "--c-accent": colors.accent,
    "--c-text": colors.text,
  } as CSSProperties;
}

/**
 * The child's calendar in a phone-wide frame with the calendar's theme. "egen" takes its colours from
 * `colors` (the calendar's customTheme, or a draft's) as inline CSS variables.
 */
export function ChildFrame({
  theme,
  colors,
  children,
}: {
  theme: Theme;
  colors?: ThemeColors | null;
  children: ReactNode;
}) {
  const style = theme === "egen" && colors ? themeVars(colors) : undefined;
  return (
    <div className="child-frame" data-theme={theme} style={style}>
      {children}
    </div>
  );
}
