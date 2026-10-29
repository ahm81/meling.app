import MelingCore
import SwiftUI

// watchOS uses MelingCore only. Data will come from the iPhone (WatchConnectivity)
// or a lightweight REST API, rather than the full Firebase SDK.
@main
struct MelingWatchApp: App {
    var body: some Scene {
        WindowGroup {
            VStack {
                Image(systemName: "house.fill")
                Text("Meling")
            }
        }
    }
}
