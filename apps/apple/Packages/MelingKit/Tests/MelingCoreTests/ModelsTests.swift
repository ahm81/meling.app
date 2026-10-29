import Foundation
import MelingCore
import Testing

@Test func familyDocDecodesFromSharedShape() throws {
    let json = #"{"name":"Meling","ownerId":"u1","memberIds":["u1"]}"#
    let family = try JSONDecoder().decode(FamilyDoc.self, from: Data(json.utf8))
    #expect(family == FamilyDoc(name: "Meling", ownerId: "u1", memberIds: ["u1"]))
}

@Test func memberPathMatchesTypeScript() {
    #expect(Paths.member(familyId: "f1", uid: "u1") == "families/f1/members/u1")
}
