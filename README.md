# @eponyme/cli

Versioned Prisma schema installer and PostgreSQL verifier for Eponyme.

```sh
pnpm add --save-dev @eponyme/cli
pnpm exec eponyme init
pnpm prisma migrate deploy
pnpm prisma generate
pnpm exec eponyme check --client server/utils/prisma.ts
```

`eponyme init` appends a managed model block to `prisma/schema.prisma` and copies the published,
immutable migration history into `prisma/migrations`. It is idempotent. Existing migration files
are never overwritten when their contents differ.

If the application already contains Eponyme models copied from an older release, review the diff
and run `eponyme init --force`. The flag replaces only the known Eponyme model blocks; it does not
replace a conflicting migration.

`eponyme check` loads the application-owned Prisma client, then verifies:

- every Eponyme Prisma model delegate;
- every required PostgreSQL table and column;
- the schema version stored in `_eponyme_schema`.

The command reads `.env` by default. Use `--cwd`, `--schema`, `--migrations`, `--client` and `--env`
when the host application uses different paths.

## Upgrades

Commit the generated migrations with the host application. For an upgrade, install the new CLI,
run `eponyme init`, inspect the added immutable migrations, deploy them with Prisma, regenerate the
client, and finish with `eponyme check`. Never edit a migration that has already run in production.

For a database whose Eponyme tables predate this published migration history, baseline the
matching old migrations with `prisma migrate resolve --applied <migration>` before deploying the
remaining migrations. Back up or export Eponyme content before applying an irreversible migration.
