import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import { apiError, HttpError } from "@/lib/http";
import { customerCsvRow } from "@/lib/customer-csv";
import { addAudit } from "@/lib/records";

export async function GET(request: Request) {
  try {
    const user = await requireUser("customers:export");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? "ACTIVE";
    const kind = searchParams.get("kind");
    const type = searchParams.get("type");
    const dateRange = searchParams.get("dateRange") ?? "ALL";
    const query = searchParams.get("q")?.trim() ?? "";
    if (!["ACTIVE", "ARCHIVED", "ALL"].includes(status)) throw new HttpError("Invalid customer status filter", 400);
    if (kind !== "BUYER" && kind !== "SUPPLIER") throw new HttpError("Select buyer or receiving-stock supplier customers", 400);
    if (type && !["INDIVIDUAL", "BUSINESS"].includes(type)) throw new HttpError("Invalid customer type filter", 400);
    if (!["ALL", "WEEK", "MONTH", "YEAR", "LAST_30_DAYS"].includes(dateRange)) throw new HttpError("Invalid customer date range", 400);
    const now = new Date();
    const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (dateRange === "WEEK") rangeStart.setUTCDate(rangeStart.getUTCDate() - ((rangeStart.getUTCDay() + 6) % 7));
    else if (dateRange === "MONTH") rangeStart.setUTCDate(1);
    else if (dateRange === "YEAR") rangeStart.setUTCMonth(0, 1);
    else if (dateRange === "LAST_30_DAYS") rangeStart.setUTCDate(rangeStart.getUTCDate() - 29);

    const customers = await prisma.customer.findMany({
      where: {
        kind,
        ...(status === "ALL" ? {} : { isActive: status === "ACTIVE" }),
        ...(type ? { type: type as "INDIVIDUAL" | "BUSINESS" } : {}),
        ...(dateRange === "ALL" ? {} : { createdAt: { gte: rangeStart } }),
        ...(query ? {
          OR: [
            { name: { contains: query } },
            { code: { contains: query } },
            { phone: { contains: query } },
            { alternativePhone: { contains: query } },
            { email: { contains: query } },
          ],
        } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    await prisma.$transaction((tx) => addAudit(tx, {
      userId: user.id,
      action: "customer.report.exported",
      entity: "Customer",
      details: { status, kind, type, dateRange, queryProvided: Boolean(query), recordCount: customers.length },
    }));
    const header = ["Customer ID", "Name", "Customer group", "Type", "Phone", "Alternative phone", "Email", "Date of birth", "Gender", "ID type", "ID number", "Address", "Address line 1", "Address line 2", "City / town", "Region", "Country", "GPS location", "Identification reference", "Notes", "Status", "Created date"];
    const content = [customerCsvRow(header), ...customers.map((customer) => customerCsvRow([
      customer.code,
      customer.name,
      customer.kind,
      customer.type,
      customer.phone,
      customer.alternativePhone,
      customer.email,
      customer.dateOfBirth?.toISOString().slice(0, 10),
      customer.gender,
      customer.idType,
      customer.idNumber,
      customer.address,
      customer.addressLine1,
      customer.addressLine2,
      customer.city,
      customer.region,
      customer.country,
      customer.gpsLocation,
      customer.tin,
      customer.notes,
      customer.isActive ? "Active" : "Archived",
      customer.createdAt.toISOString(),
    ]))].join("\r\n");
    return new Response(`\uFEFF${content}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="big-joe-gold-customers-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
