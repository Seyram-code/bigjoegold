import { prisma } from "@/lib/prisma";
import { can, requireUser } from "@/lib/authz";
import { apiError, HttpError } from "@/lib/http";

const normalizePhone = (value: string) => value.replace(/\D/g, "");
const normalizeName = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

export async function GET(request: Request) {
  try {
    const user = await requireUser("customers:personal:read");
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name")?.trim() ?? "";
    const phone = searchParams.get("phone")?.trim() ?? "";
    const email = searchParams.get("email")?.trim().toLowerCase() ?? "";
    const kind = searchParams.get("kind");
    if (kind !== "BUYER" && kind !== "SUPPLIER") throw new HttpError("Select buyer or receiving-stock supplier customers", 400);
    if (name.length < 2 && normalizePhone(phone).length < 5 && email.length < 5) {
      throw new HttpError("Enter a name, phone number, or email to check for possible duplicates", 400);
    }

    const candidates = await prisma.customer.findMany({
      where: {
        kind,
        OR: [
          ...(name.length >= 2 ? [{ name: { contains: name } }] : []),
          ...(email ? [{ email: { equals: email } }] : []),
          ...(normalizePhone(phone).length >= 5 ? [{ phone: { contains: normalizePhone(phone).slice(-5) } }, { alternativePhone: { contains: normalizePhone(phone).slice(-5) } }] : []),
        ],
      },
      select: { id: true, code: true, name: true, type: true, phone: true, alternativePhone: true, email: true },
      take: 100,
    });
    const normalizedName = normalizeName(name);
    const phoneDigits = normalizePhone(phone);
    const matches = candidates.flatMap((candidate) => {
      const reasons: string[] = [];
      if (normalizedName && normalizeName(candidate.name) === normalizedName) reasons.push("Matching name");
      if (email && candidate.email?.toLowerCase() === email) reasons.push("Matching email");
      if (phoneDigits.length >= 5 && [candidate.phone, candidate.alternativePhone].some((value) => value && normalizePhone(value) === phoneDigits)) reasons.push("Matching phone");
      if (!reasons.length) return [];
      return [{
        id: candidate.id,
        code: candidate.code,
        name: candidate.name,
        type: candidate.type,
        reasons,
        ...(can(user.role, "customers:personal:read", user.permissions) ? { phone: candidate.phone } : {}),
      }];
    });
    return Response.json(matches.slice(0, 10));
  } catch (error) {
    return apiError(error);
  }
}
