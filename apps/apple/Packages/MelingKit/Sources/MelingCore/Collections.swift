// Firestore paths. Keep in sync with docs/datamodel.md and packages/shared/src/collections.ts.
public enum Collections {
    public static let members = "members"
}

public enum Paths {
    public static func member(_ uid: String) -> String { "\(Collections.members)/\(uid)" }
}
