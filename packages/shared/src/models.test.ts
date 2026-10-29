import { describe, expect, it } from "vitest";
import { paths } from "./collections";
import { MemberDoc } from "./models";

describe("MemberDoc", () => {
  it("accepts a valid member", () => {
    const member = { displayName: "Amund", email: "amund@example.com" };
    expect(MemberDoc.parse(member)).toEqual(member);
  });

  it("rejects an empty display name", () => {
    expect(MemberDoc.safeParse({ displayName: "", email: "amund@example.com" }).success).toBe(false);
  });
});

describe("paths", () => {
  it("builds member paths", () => {
    expect(paths.member("u1")).toBe("members/u1");
  });
});
