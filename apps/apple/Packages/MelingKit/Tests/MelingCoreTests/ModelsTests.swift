import Foundation
import MelingCore
import Testing

@Test func memberDocDecodesFromSharedShape() throws {
    let json = #"{"displayName":"Amund","email":"amund@example.com"}"#
    let member = try JSONDecoder().decode(MemberDoc.self, from: Data(json.utf8))
    #expect(member == MemberDoc(displayName: "Amund", email: "amund@example.com"))
}

@Test func memberPathMatchesTypeScript() {
    #expect(Paths.member("u1") == "members/u1")
}
