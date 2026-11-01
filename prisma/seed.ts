import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { createOwnerCredentialUser } from "../src/lib/staff";

async function main() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PHONE, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PHONE || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error("Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_PHONE, and an ADMIN_PASSWORD of at least 12 characters in .env before seeding.");
  }
  if (await prisma.user.count() > 0) {
    console.log("Staff already exists; seed did not create another owner.");
    return;
  }

  const owner = await prisma.$transaction(async (tx) =>
    createOwnerCredentialUser(tx, {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      phone: ADMIN_PHONE,
      password: ADMIN_PASSWORD,
    }),
  );
  console.log(`Created initial owner account for ${owner.email}.`);
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
