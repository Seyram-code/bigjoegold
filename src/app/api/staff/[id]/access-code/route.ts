import { hashPassword } from "better-auth/crypto";
import { decryptStaffAccessCode, encryptStaffAccessCode, generateStaffAccessCode, generateStaffAuthEmail, hashStaffAccessCode, staffAccessCredentialPassword } from "@/lib/staff";
import { can, requireUser } from "@/lib/authz";
import { apiError, HttpError, readJson } from "@/lib/http";
import { clearLoginFailures } from "@/lib/login-lockout";
import { prisma } from "@/lib/prisma";
import { addAudit } from "@/lib/records";
import { z } from "zod";

type Context = { params: Promise<{ id: string }> };
const emptyBodySchema = z.object({}).strict();

export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await requireUser("staff:read");
    if (actor.role !== "OWNER") throw new HttpError("Only an owner can view staff access codes", 403);
    const { id } = await params;
    const staff = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, isActive: true, accessCodeEncrypted: true },
    });
    if (!staff) throw new HttpError("Staff member not found", 404);
    if (staff.role === "OWNER") throw new HttpError("Owner accounts do not use staff access codes", 400);
    if (!staff.isActive) throw new HttpError("Activate this staff account before viewing its access code", 400);
    if (!staff.accessCodeEncrypted) {
      throw new HttpError("This access code cannot be viewed because it predates encrypted code storage. Generate a new code first.", 409);
    }
    const accessCode = decryptStaffAccessCode(staff.accessCodeEncrypted);
    await prisma.$transaction((tx) => addAudit(tx, {
      userId: actor.id,
      action: "staff.access_code.viewed",
      entity: "User",
      entityId: id,
      details: { before: null, after: { accessCodeViewed: true } },
    }));
    return Response.json({ name: staff.name, accessCode });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    emptyBodySchema.parse(await readJson(request));
    const actor = await requireUser("staff:write");
    const { id } = await params;
    const code = generateStaffAccessCode();
    const password = await hashPassword(staffAccessCredentialPassword(code));
    const email = generateStaffAuthEmail();

    await prisma.$transaction(async (tx) => {
      const staff = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true } });
      if (!staff) throw new HttpError("Staff member not found", 404);
      if (staff.role === "OWNER") throw new HttpError("Owners sign in with email and password; their credentials cannot be replaced with a staff access code", 400);
      if (!staff.isActive) throw new HttpError("Activate this staff account before generating an access code", 400);
      if (!can(actor.role, "staff:write", actor.permissions)) {
        throw new HttpError("You cannot generate a staff access code", 403);
      }

      const updatedAccounts = await tx.account.updateMany({
        where: { userId: id, providerId: "credential" },
        data: { password },
      });
      if (updatedAccounts.count !== 1) throw new Error(`Staff member ${id} does not have exactly one credential account`);

      await tx.user.update({
        where: { id },
        data: {
          email,
          accessCodeHash: hashStaffAccessCode(code),
          accessCodeEncrypted: encryptStaffAccessCode(code),
        },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      await addAudit(tx, {
        userId: actor.id,
        action: "staff.access_code.generated",
        entity: "User",
        entityId: id,
        details: { before: null, after: { accessCodeGenerated: true } },
      });
    });

    await clearLoginFailures(`user:${id}`);
    return Response.json({ accessCode: code });
  } catch (error) {
    return apiError(error);
  }
}
