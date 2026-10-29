import MelingFirebase
import SwiftUI

@main
struct MelingApp: App {
    init() {
        MelingFirebase.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
