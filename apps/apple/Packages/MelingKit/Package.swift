// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MelingKit",
    platforms: [.iOS(.v18), .macOS(.v15), .watchOS(.v11), .tvOS(.v18)],
    products: [
        // Pure Swift models and paths. Usable on every platform, including watchOS.
        .library(name: "MelingCore", targets: ["MelingCore"]),
        // Firebase-backed services for iOS, macOS and tvOS.
        .library(name: "MelingFirebase", targets: ["MelingFirebase"]),
    ],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", from: "13.1.0"),
    ],
    targets: [
        .target(name: "MelingCore"),
        .target(
            name: "MelingFirebase",
            dependencies: [
                "MelingCore",
                .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
                .product(name: "FirebaseFirestore", package: "firebase-ios-sdk"),
            ]
        ),
        .testTarget(name: "MelingCoreTests", dependencies: ["MelingCore"]),
    ]
)
