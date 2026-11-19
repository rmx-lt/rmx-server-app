# rmx-server-app — notes for agents

Project-wide agent rules live in the meta repo's [CLAUDE.md](https://github.com/rmx-lt/blade-of-grass/blob/development/CLAUDE.md); read it first. This file only adds what is specific to this repo.

- **Layout and import rules:** read wiki Server-App, section "Repository layout" (`wiki/Server-App.md`), before adding a package, a domain or a `web/src` folder. Go rules are enforced by `internal/arch/arch_test.go` (every package needs a layer there), `internal/arch/contracts_test.go` (tables, `api` files, MQTT topics and links per domain, wiki Server-App "Module map") and the public-route allow-list in `internal/app/routes_test.go`; web rules by `bun run lint` (`web/eslint.config.mjs`).
- **Local dev app:** run `bun run dev` from the repo root, then log in at http://localhost:3000/ as `dev` / `123` (wiki Server-App, "Local development").
