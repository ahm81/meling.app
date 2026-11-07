import Foundation

// Mirrors the zod schemas in packages/shared/src/models.ts.
// A signed-in user has access if and only if members/{uid} exists.

public enum MemberRole: String, Codable, Sendable, Equatable {
    case adult
    case child
}

public struct MemberDoc: Codable, Sendable, Equatable {
    public var displayName: String
    public var email: String
    public var role: MemberRole

    public init(displayName: String, email: String, role: MemberRole) {
        self.displayName = displayName
        self.email = email
        self.role = role
    }
}
