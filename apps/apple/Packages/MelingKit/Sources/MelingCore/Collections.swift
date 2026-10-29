// Firestore paths. Keep in sync with docs/datamodel.md and packages/shared/src/collections.ts.
public enum Collections {
    public static let users = "users"
    public static let families = "families"
    public static let members = "members"
}

public enum Paths {
    public static func user(_ uid: String) -> String { "\(Collections.users)/\(uid)" }
    public static func family(_ familyId: String) -> String { "\(Collections.families)/\(familyId)" }
    public static func member(familyId: String, uid: String) -> String {
        "\(Collections.families)/\(familyId)/\(Collections.members)/\(uid)"
    }
}
