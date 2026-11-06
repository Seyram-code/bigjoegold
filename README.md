# Big Joe Gold

A locally run gold trading management application built with Next.js App Router, strict TypeScript, Tailwind CSS, shadcn-style UI primitives, Prisma, MySQL, Better Auth, Zod, React Hook Form, Recharts, and Lucide icons. GHS is the reporting currency; board prices retain their configured currency and quoted unit, while trade weights are entered in kilograms.

## Local setup

Requirements: Node.js 20+, npm, and MySQL 8+.

1. Create a MySQL database and a dedicated local application user.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL`, a random `BETTER_AUTH_SECRET` (at least 32 characters), `BETTER_AUTH_URL`, `STAFF_ACCESS_CODE_ENCRYPTION_KEY`, and the initial owner's name, email, phone number, and a strong password of at least 12 characters. Generate the encryption key with `openssl rand -base64 32`; keep it secret and backed up, since losing it makes encrypted staff access codes unreadable.
3. Install dependencies and prepare the database:

   ```bash
   npm install
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

4. Run `npm run dev` and sign in at `http://127.0.0.1:3000/login`. Owners use their email and password; staff use the one-time `BJG` plus four-digit access code issued by the owner.

Do not commit `.env` or use example credentials outside a throwaway local setup. Staff accounts are created by an owner from the Staff screen using a name and phone number; their generated access codes are stored encrypted and can be viewed by an owner. Viewing a code is recorded in the audit log. Owner email/password sign-in is restricted to active owner accounts. Public account registration is disabled. Use `npm run db:deploy` to apply migrations outside development.

### Owner SMS notifications

To send operational notifications to the owner, create a Wigal FROG account and set `WIGAL_FROG_API_KEY`, `WIGAL_FROG_USERNAME`, `WIGAL_FROG_SENDER_ID`, and `WIGAL_FROG_OWNER_PHONE` in `.env`. The phone setting accepts one number or a comma-separated list (for example, `+233XXXXXXXXX,+233YYYYYYYYY`). The sender ID must be approved by FROG. Once configured, the app sends each recipient a confirmation after a completed purchase, a posted sale, and a payment recorded from the Payments area. SMS delivery is best-effort and cannot roll back a completed business transaction.

### Owner email notifications and password recovery

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and optionally `SMTP_FROM` in the deployment environment. For a Hostinger mailbox, use `smtp.hostinger.com` with port `465` and SSL (`SMTP_SECURE=true`), or port `587` with STARTTLS (`SMTP_SECURE=false`). Use the mailbox address as `SMTP_USER`; never commit mailbox credentials. If `SMTP_FROM` is omitted, the mailbox address is used. Set `BETTER_AUTH_URL` to the application's public HTTPS origin so reset links point back to the deployed site. Owner transaction notification emails are suspended by default; set `OWNER_TRANSACTION_EMAILS_ENABLED=true` to resume them. SMTP remains available for password-reset emails regardless of this setting.

When owner transaction emails are enabled and SMTP is configured, every active owner account receives a summary after a purchase or sale is completed, including gold fulfilled from a customer advance, and after a payment is recorded. Owners can request a password-reset link from the sign-in page. Links expire after one hour, are single-use, and a successful reset revokes the owner's existing sessions. Responses do not disclose whether an email belongs to an owner account. Email delivery is best-effort for transaction notifications and does not roll back a saved transaction; SMTP must be configured for password recovery.

For an existing installation, keep an owner signed in while applying the staff migration, then use Staff & Access to generate codes for active accounts before signing out. Generating a code replaces the prior credential and signs out that staff member's existing sessions; old email/password credentials will not work after this change.

## Business behavior

- Trade creation, stock movement, payments, and audit changes commit atomically.
- Receive Stock has a dedicated purchase workflow. Purchase drafts do not create stock movements, batches, or payments; completing a purchase creates the posted trade, inventory lot, stock receipt movement, any outgoing payment, and audit entry in one database transaction. Receipt references remain stable from draft through completion. Stock issue movements are also recorded for posted sales; the migration backfills movements for existing posted trades.
- Receiving formulas are calculated in `src/lib/gold.ts` using the saved `PurchaseFormulaConfig` values and versioned with each purchase. Pounds and displayed Density are truncated to two decimal places. A separately rounded two-decimal Density intermediate is used to calculate Karat; Karat and derived Purity are then rounded to two decimal places to match the external assay calculator. The purchase amount uses the displayed Pounds and Karat, is truncated to GHS pesewas for storage, and is shown as whole GHS with `.00` in the receiving preview. Karat is calculated as `(density − 10.51) × 52.395 ÷ density`. Purchase amount is `(karat − 0.7 percentage points) × board price ÷ 23 × pounds`; the formula factors are configurable. Other system numeric calculations continue to truncate at their existing precision limits. Users with `settings:manage` can edit and save the formula factors from Settings; each save is audit logged, and formula changes increment the version. Editing a factor clears the confirmation checkbox. Purchase completion remains blocked until an authorized administrator explicitly confirms the saved formulas and units after business review. Calculation results are not manually editable; the API rejects additional override fields.
- The Manso Branch workflow tracks branch funds in a dedicated GHS cash account. Transfers to and from the branch are recorded in the Finance ledger; gold receipts use the saved measurement formula but the manually entered actual purchase cost, never the current board price. Branch purchases create posted inventory batches and purchase records, while expenses use the normal finance approval threshold. Reports keep Manso purchases out of supplier payable summaries and show a separate daily branch reconciliation of advances, actual gold purchase value, expenses, returned cash, and the running balance.
- The receiving form records the current board price, its GHS-per-pure-gram unit, transaction date, measurement inputs/results, payment details, formula version, and supporting-document reference. New purchases automatically use the latest compatible published GHS-per-pure-gram price; older prices remain in price history and saved purchase records, not as choices for a new purchase. File upload storage is not configured; supporting documents can currently be recorded by reference or URL.
- Purchases add gross gold weight to FIFO inventory lots. Sales lock available lots, consume stock FIFO, and persist lot allocations and cost basis. A sale with insufficient available weight is rejected without partial changes.
- Trade value is pure grams (`kg × 1,000 × purity / 10,000`) multiplied by the entered GHS-per-pure-gram rate. Trade totals are truncated to pesewas.
- Trade balances are reduced by allocated payments. Direction, allocation, and outstanding balance are validated server-side.
- Transaction forms accept backdated business dates and persist the selected date across the trade, related stock movements, and linked payments. Future transaction dates are rejected; record creation timestamps remain separate for audit purposes.
- Manual Bank & MOMO ledgers provide one date-based close report for all mobile money and bank accounts, showing each account's opening balance, payments received, payments made, closing balance, and its transactions with running balances; the consolidated report can be printed or saved as PDF.
- Board prices are maintained separately for receiving stock and releasing/selling gold. Each price records its direction, currency, unit, effective time, source, note, and publisher. Publishing requires explicit confirmation against the current rate for that direction; stale confirmations are rejected and every rate is retained in append-only history. Historical changes are compared only when direction, currency, and unit match. Purchases keep their selected receiving-price ID, amount, unit, and formula inputs as an immutable snapshot; changing the board never recalculates an old transaction. Inventory market valuation and gold releases use a compatible selling price, while receiving calculations use a compatible receiving price.
- Staff permissions are checked in server APIs, not only hidden in the interface. Audit entries are written in the same transaction as core financial changes.
- The MySQL schema stores roles, permissions, role grants, and per-user permission overrides as related Prisma models with foreign keys; user access is resolved from these records on each server request. Gold purchases and sales share the indexed `Trade` ledger with a typed transaction kind; purchase assay inputs and derived measurements are normalized into `GoldPurchaseMeasurement`. `InventoryLot`, `CashAccount`, `CashMovement`, and `SaleCorrection` are the batch, financial-account/transaction, and return/reversal ledgers respectively. Financial amounts use fixed-precision decimals, gold weights and density use higher-precision decimals, and workflow writes are atomic.
- Staff roles include Owner, Manager, Gold Receiver / Buyer, Sales Officer, Inventory Officer, Accountant, Read-only Auditor, and legacy Trader / Viewer roles. Owners can create additional owner accounts with email/password credentials separately from staff access-code accounts, and assign per-user permission overrides for purchases, sales, inventory, payments, finance approvals, reports, price changes, staff, audit, and settings. Permission changes take effect on the next request; only an owner can assign the Owner role, users cannot change their own access, and the last active owner cannot be demoted or deactivated. High-value finance actions require the separate approval permission, reversals require transaction-reversal permission, and manual calculation override fields remain rejected. Staff and approval changes record before-and-after audit details, with secret-like fields redacted.
- Customer records support active/archive status, possible-duplicate review, transaction and payment history, and permission-gated CSV exports. Personal contact and identification fields are restricted to roles with customer-personal-data access.
- Generated customer codes use the format `BJG-<customer initials>-<five random digits>` (for example, `BJG-RA-04281` for Roselyn Agyeman).
- Buyer Gold Financing records cash advances paid to a buyer separately from customer-paid gold advances. A received gold purchase can be linked to the buyer's financing account while retaining its normal supplier profile, assay calculation, purchase receipt, and inventory posting. The calculated purchase value reduces the account balance; a positive balance means the customer owes Big Joe, and a negative balance means Big Joe owes the customer.
- Recording a customer cash advance can optionally include a requested gold weight in grams. The gold request and advance are saved atomically; the request is non-binding until gold is released.
- The customer gold advance and buyer gold financing sections of Reports can generate customer-wide statements across each customer's accounts, with a chronological transaction table and running balance. Statements include full account history and can be printed or saved as PDF.
- The Financing report lists customer advance and buyer-financing movements by date, includes current account balances, and links report entries to customer profiles for users with customer access. Daily summaries show supplier purchase stock, purchase value, and outstanding balances, plus customer financing stock received, cash advanced, and running balances. Summary activity respects the selected date range; balances include earlier account activity.
- Financial reports distinguish gross/net trading results and payment cash flows.
- The Reports workspace provides day/week/month purchase and sales totals, date-filtered transaction details, current stock by batch and karat, FIFO inventory valuation, customer transaction history, payment and outstanding balances, cash flows, stock movements, staff activity, and board-price history. It reads persisted database records and applies the same role permissions as the corresponding workspace areas; customer details and staff names are restricted by their specific permissions. Reports can be printed or saved as PDF through the browser print dialog and exported as a multi-sheet Excel-compatible workbook.
- Realized profit is the net sale value less the FIFO receiving cost of the grams sold or released. A partial sale recognizes only the allocated grams' receiving cost, leaving unsold stock in inventory. Reports show profit in GHS, gross margin (profit divided by sale value), and return on cost (profit divided by receiving cost); both percentages are also available per sale.

## Operational readiness

Configure MySQL backups, access controls, TLS, and a strong authentication secret before storing real business records. Authentication and selected write/download APIs use database-backed rate limits.

### Hostinger Git deployments

For a Hostinger deployment, set `HOSTINGER_BUILD=1` in the website's environment variables. The build then applies pending Prisma migrations and runs the initial-owner seed; the seed does nothing once any staff account exists. Set `DATABASE_URL` and, for an empty database, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PHONE`, and a strong `ADMIN_PASSWORD` (at least 12 characters) in Hostinger, not in Git. Local builds do not run migrations or seed data.

### Backup and restore

- Schedule encrypted backups of the MySQL database and store copies outside the application host with access limited to administrators. Protect backup encryption keys separately from the backup files.
- Back up before schema migrations and retain multiple dated recovery points according to the business retention policy. Restore a backup into a separate test database regularly and verify application access and representative records.
- For an actual restore, stop application writes, identify and independently confirm the exact MySQL host and database name, and restore only to the intended target. Verify the restored database before reopening writes.
- Apply additive schema changes with `npm run db:deploy` after reviewing the migration and confirming the target database. Never run `prisma migrate reset`, drop/recreate the database, or otherwise use destructive reset commands against production or any database containing business records.

This local application does not include external bank/mobile-money integrations, statutory tax submission, accounting-system export, or an independent physical-stock reconciliation workflow. Confirm local accounting and regulatory requirements with qualified professionals before using reports for statutory filings.

Useful checks: `npm run typecheck`, `npm run lint`, and `npm run build`.

## Workspace navigation

The desktop workspace keeps the dark navy operations rail fixed while the content area scrolls; on narrower screens the rail becomes a slide-out navigation drawer. Operational workspace data refreshes every three seconds without reloading the page or resetting form values; background refresh pauses when the browser tab is hidden. Settings remains manually loaded so background updates cannot overwrite unsaved formula edits. Use the global header search or `⌘K` / `Ctrl+K` to find customers, trades, and payments. The board-rate chip opens published pricing; the notification menu summarizes open balances and available stock. Operational tables include client-side search and pagination, while financial reports use a shared date-range filter. Destructive staff access changes require an explicit confirmation.

Use the theme button in the header to switch between light and dark appearance. On narrow screens, open the navigation drawer to find the theme button. The preference is saved in the current browser and also applies to the sign-in screen.
