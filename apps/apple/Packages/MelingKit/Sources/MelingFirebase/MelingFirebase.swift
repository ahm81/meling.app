import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import MelingCore

public enum MelingFirebase {
    /// Configures Firebase from GoogleService-Info.plist in the app bundle.
    /// Pass `-useEmulators` as a launch argument to talk to the local Emulator Suite.
    /// Returns false when the plist is missing, so the app can still run without Firebase.
    @discardableResult
    public static func configure(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        guard FirebaseApp.app() == nil else { return true }
        guard Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil else {
            print("MelingFirebase: GoogleService-Info.plist not found, Firebase is not configured.")
            return false
        }
        FirebaseApp.configure()

        if arguments.contains("-useEmulators") {
            Auth.auth().useEmulator(withHost: "127.0.0.1", port: 9099)
            let settings = Firestore.firestore().settings
            settings.host = "127.0.0.1:8080"
            settings.isSSLEnabled = false
            settings.cacheSettings = MemoryCacheSettings()
            Firestore.firestore().settings = settings
        }
        return true
    }
}

public struct FamilyRepository: Sendable {
    public init() {}

    public func family(id: String) async throws -> FamilyDoc {
        try await Firestore.firestore().document(Paths.family(id)).getDocument(as: FamilyDoc.self)
    }
}
