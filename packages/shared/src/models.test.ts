import { describe, expect, it } from "vitest";
import { paths } from "./collections";
import { MemberDoc } from "./models";

describe("MemberDoc", () => {
  it("accepts a valid member", () => {
    const member = { displayName: "Amund", email: "amund@example.com", role: "adult" };
    expect(MemberDoc.parse(member)).toEqual(member);
  });

  it("rejects an empty display name", () => {
    expect(MemberDoc.safeParse({ displayName: "", email: "amund@example.com", role: "adult" }).success).toBe(false);
  });

  it("accepts the child role", () => {
    expect(MemberDoc.parse({ displayName: "Ida", email: "ida@example.com", role: "child" }).role).toBe("child");
  });

  it("rejects an unknown role", () => {
    expect(MemberDoc.safeParse({ displayName: "Ida", email: "ida@example.com", role: "admin" }).success).toBe(false);
  });

  it("rejects a missing role", () => {
    expect(MemberDoc.safeParse({ displayName: "Ida", email: "ida@example.com" }).success).toBe(false);
  });
});

describe("paths", () => {
  it("builds member paths", () => {
    expect(paths.member("u1")).toBe("members/u1");
  });
});
