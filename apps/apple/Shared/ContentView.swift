import MelingCore
import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "house.fill")
                .font(.largeTitle)
                .foregroundStyle(.tint)
            Text("Meling")
                .font(.title)
            Text("Roller: \(MemberRole.allCases.map(\.rawValue).joined(separator: ", "))")
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
