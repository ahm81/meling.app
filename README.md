# meling.app

Privat app for Meling-familien, med web (React), Apple-klienter (iOS, macOS, watchOS, tvOS) og Firebase-backend.

## Kom i gang

Krever Node 22, pnpm 11, Xcode og XcodeGen (`brew install xcodegen`).

```bash
pnpm install
pnpm emulators                      # i én terminal
cp apps/web/.env.example apps/web/.env.local
pnpm add-member --email du@example.com --name Navn --emulator
pnpm --filter @meling/web dev       # i en annen
```

Apple:

```bash
cd apps/apple
xcodegen generate
open Meling.xcodeproj
```

Se [CLAUDE.md](CLAUDE.md) for struktur og konvensjoner, og [docs/datamodel.md](docs/datamodel.md) for datamodellen.
