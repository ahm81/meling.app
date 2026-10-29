import Foundation

// Mirrors the zod schemas in packages/shared/src/models.ts.

public enum MemberRole: String, Codable, Sendable, CaseIterable {
    case parent
    case child
}

public struct UserDoc: Codable, Sendable, Equatable {
    public var displayName: String
    public var email: String?
    public var familyIds: [String]

    public init(displayName: String, email: String? = nil, familyIds: [String] = []) {
        self.displayName = displayName
        self.email = email
        self.familyIds = familyIds
    }
}

public struct FamilyDoc: Codable, Sendable, Equatable {
    public var name: String
    public var ownerId: String
    public var memberIds: [String]

    public init(name: String, ownerId: String, memberIds: [String]) {
        self.name = name
        self.ownerId = ownerId
        self.memberIds = memberIds
    }
}

public struct MemberDoc: Codable, Sendable, Equatable {
    public var displayName: String
    public var role: MemberRole

    public init(displayName: String, role: MemberRole) {
        self.displayName = displayName
        self.role = role
    }
}

public struct CreateFamilyRequest: Codable, Sendable, Equatable {
    public var name: String
    public var displayName: String

    public init(name: String, displayName: String) {
        self.name = name
        self.displayName = displayName
    }
}

public struct CreateFamilyResponse: Codable, Sendable, Equatable {
    public var familyId: String
}
