# Production release runbook

Use Node 20 LTS or newer and install dependencies from the committed lockfile:

```sh
npm ci
```

Before applying a release that contains Prisma migrations, take and verify a database backup. Run the database release step once, from one trusted deployment worker only:

```sh
npm run db:release
```

Then build and deploy the application:

```sh
npm run build
```

Do not run `prisma migrate deploy` as a build hook. Concurrent builds can otherwise race to alter the same production schema, and a failed application build can leave the database ahead of the running application.

After deployment, verify the login flow, one read-only dashboard request, and the affected release workflow. Keep the backup until the release has completed its operational checks.
