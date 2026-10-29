import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "house.fill")
                .font(.largeTitle)
                .foregroundStyle(.tint)
            Text("Meling")
                .font(.title)
            Text("Kun for Meling-familien")
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
