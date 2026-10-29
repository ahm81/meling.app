import Foundation

// Mirrors the zod schemas in packages/shared/src/models.ts.
// A signed-in user has access if and only if members/{uid} exists.

public struct MemberDoc: Codable, Sendable, Equatable {
    public var displayName: String
    public var email: String

    public init(displayName: String, email: String) {
        self.displayName = displayName
        self.email = email
    }
}
