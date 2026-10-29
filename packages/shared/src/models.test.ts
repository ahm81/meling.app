import { describe, expect, it } from "vitest";
import { CreateFamilyRequest, FamilyDoc } from "./models";

describe("CreateFamilyRequest", () => {
  it("accepts a valid request", () => {
    expect(CreateFamilyRequest.parse({ name: "Meling", displayName: "Amund" })).toEqual({
      name: "Meling",
      displayName: "Amund",
    });
  });

  it("rejects an empty family name", () => {
    expect(CreateFamilyRequest.safeParse({ name: "", displayName: "Amund" }).success).toBe(false);
  });
});

describe("FamilyDoc", () => {
  it("requires at least one member", () => {
    expect(FamilyDoc.safeParse({ name: "Meling", ownerId: "u1", memberIds: [] }).success).toBe(false);
  });
});
