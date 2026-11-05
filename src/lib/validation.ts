import { z } from "zod";

const positiveAmount = z.coerce.number().finite().positive().multipleOf(0.01);
const optionalText = z.string().trim().max(500).optional().or(z.literal(""));

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["SUPPLIER", "BUYER"]),
  type: z.enum(["INDIVIDUAL", "BUSINESS"]),
  phone: optionalText,
  alternativePhone: optionalText,
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  dateOfBirth: z.union([z.string().date(), z.literal("")]).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"]).optional().or(z.literal("")),
  idType: z.enum(["GHANA_CARD", "PASSPORT", "DRIVERS_LICENSE", "VOTER_ID", "OTHER"]).optional().or(z.literal("")),
  idNumber: optionalText,
  tin: optionalText,
  address: optionalText,
  addressLine1: z.string().trim().max(191).optional().or(z.literal("")),
  addressLine2: z.string().trim().max(191).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  region: z.string().trim().max(120).optional().or(z.literal("")),
  country: z.string().trim().min(1).max(120).optional(),
  gpsLocation: z.string().trim().max(191).optional().or(z.literal("")),
  notes: optionalText,
}).strict();
export type CustomerInput = z.infer<typeof customerSchema>;

export const customerUpdateSchema = customerSchema.omit({ kind: true }).partial().extend({
  isActive: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0);

const manualMomoMoney = z.string().trim()
  .regex(/^\d{1,14}(?:\.\d{1,2})?$/, "Enter an amount with up to 2 decimal places")
  .refine((value) => Number.isFinite(Number(value)), "Enter a finite amount");

export const manualMomoEntrySchema = z.object({
  accountId: z.string().trim().min(1).max(191),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  customerName: z.string().trim().min(2).max(120),
  customerPhone: optionalText,
  amount: manualMomoMoney.refine((value) => Number(value) > 0, "Amount must be greater than zero"),
  transactionReference: z.string().trim().max(191).optional().or(z.literal("")),
  transactionDate: z.string().datetime(),
  note: optionalText,
}).strict();

export const manualMomoContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).optional().or(z.literal(""))
    .refine((value) => !value || (value.replace(/\D/g, "").length >= 5 && value.replace(/\D/g, "").length <= 15), "Enter a valid phone number"),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  notes: optionalText,
}).strict();

export const manualMomoContactImportRowSchema = manualMomoContactSchema.extend({
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

export const manualMomoAccountSchema = z.object({
  accountId: z.string().trim().min(1).max(191),
  openingBalance: manualMomoMoney.refine((value) => Number(value) >= 0, "Opening balance cannot be negative"),
  openingDate: z.string().datetime(),
}).strict();

export const manualMomoAccountCreateSchema = z.object({
  type: z.enum(["BANK", "MOBILE_MONEY"]),
  name: z.string().trim().min(2).max(120),
  bankNameTelco: z.string().trim().min(2, "Enter a bank or telco name").max(120),
  accountNumber: z.string().trim().min(1).max(120),
  openingBalance: manualMomoMoney.refine((value) => Number(value) >= 0, "Opening balance cannot be negative"),
  openingDate: z.string().datetime(),
}).strict();

export const tradeSchema = z.object({
  type: z.enum(["PURCHASE", "SALE"]),
  customerId: z.string().trim().optional().or(z.literal("")),
  quantityKg: z.coerce.number().finite().min(0.000001).max(100000),
  purityBps: z.coerce.number().int().min(1).max(10000),
  pricePerGram: positiveAmount.max(100000000),
  initialPayment: z.coerce.number().finite().min(0).multipleOf(0.01).default(0),
  cashAccountId: z.string().trim().optional().or(z.literal("")),
  method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"]).default("CASH"),
  note: optionalText,
}).strict().refine((data) => data.initialPayment === 0 || Boolean(data.cashAccountId), {
  message: "Select the account used for the initial payment",
  path: ["cashAccountId"],
});

const saleWeightKg = z.string().trim()
  .regex(/^\d{1,6}(?:\.\d{1,8})?$/, "Enter a weight with up to 8 decimal places")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Weight must be greater than zero");
const saleGrams = z.string().trim()
  .regex(/^\d{1,11}(?:\.\d{1,5})?$/, "Enter grams with up to 5 decimal places")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Batch allocation must be greater than zero");
const salePrice = z.string().trim()
  .regex(/^\d{1,12}(?:\.\d{1,6})?$/, "Enter a price with up to 6 decimal places")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Price must be greater than zero");
const saleMeasurementGrams = z.string().trim()
  .regex(/^\d{1,6}(?:\.\d{1,8})?$/, "Enter grams with up to 8 decimal places")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Measurement must be greater than zero");
const saleMoney = z.string().trim()
  .regex(/^\d{1,14}(?:\.\d{1,2})?$/, "Enter an amount with up to 2 decimal places")
  .refine((value) => Number.isFinite(Number(value)), "Enter a finite amount");

export const saleSchema = z.object({
  customerId: z.string().trim().max(191).optional().or(z.literal("")),
  transactionDate: z.string().datetime(),
  quantityKg: saleWeightKg,
  purityBps: z.coerce.number().int().min(1).max(10000),
  pricePerGram: salePrice,
  discountAmount: saleMoney,
  initialPayment: saleMoney.default("0"),
  cashAccountId: z.string().trim().optional().or(z.literal("")),
  method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"]).default("CASH"),
  note: optionalText,
  allocations: z.array(z.object({
    lotId: z.string().trim().min(1).max(191),
    grams: saleGrams,
  }).strict()).min(1).max(50),
  topGrams: saleMeasurementGrams.optional(),
  downGrams: saleMeasurementGrams.optional(),
}).strict()
  .refine((data) => Number(data.initialPayment) === 0 || Boolean(data.cashAccountId), {
    message: "Select the account used for the initial payment",
    path: ["cashAccountId"],
  })
  .refine((data) => Boolean(data.topGrams && data.downGrams), {
    message: "Enter top and down weight measurements to calculate the sale price",
    path: ["topGrams"],
  });
export type SaleInput = z.infer<typeof saleSchema>;

const advanceMoney = z.string().trim()
  .regex(/^\d{1,14}(?:\.\d{1,2})?$/, "Enter an amount with up to 2 decimal places")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Amount must be greater than zero");

export const customerAdvanceSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE_ADVANCE"),
    customerId: z.string().trim().min(1).max(191),
    amount: advanceMoney,
    requestedGrams: saleGrams.optional(),
    cashAccountId: z.string().trim().min(1).max(191),
    method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"]),
    paidAt: z.string().datetime(),
    note: optionalText,
  }).strict(),
  z.object({
    action: z.literal("ADD_FUNDS"),
    advanceId: z.string().trim().min(1).max(191),
    amount: advanceMoney,
    cashAccountId: z.string().trim().min(1).max(191),
    method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"]),
    paidAt: z.string().datetime(),
    note: optionalText,
  }).strict(),
  z.object({
    action: z.literal("REFUND"),
    advanceId: z.string().trim().min(1).max(191),
    amount: advanceMoney,
    cashAccountId: z.string().trim().min(1).max(191),
    method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"]),
    paidAt: z.string().datetime(),
    note: z.string().trim().min(5).max(500),
  }).strict(),
  z.object({
    action: z.literal("CREATE_REQUEST"),
    advanceId: z.string().trim().min(1).max(191),
    requestedGrams: saleGrams,
    note: optionalText,
  }).strict(),
  z.object({
    action: z.literal("FULFILL"),
    requestId: z.string().trim().min(1).max(191),
    transactionDate: z.string().datetime(),
    purityBps: z.coerce.number().int().min(1).max(10000),
    pricePerGram: salePrice,
    topGrams: saleMeasurementGrams,
    downGrams: saleMeasurementGrams,
    note: optionalText,
    allocations: z.array(z.object({
      lotId: z.string().trim().min(1).max(191),
      grams: saleGrams,
    }).strict()).min(1).max(50),
  }).strict(),
]);
export type CustomerAdvanceInput = z.infer<typeof customerAdvanceSchema>;

export const buyerFinanceSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE_ADVANCE"),
    customerId: z.string().trim().min(1).max(191),
    amount: advanceMoney,
    cashAccountId: z.string().trim().min(1).max(191),
    method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"]),
    paidAt: z.string().datetime(),
    note: optionalText,
  }).strict(),
  z.object({
    action: z.literal("ADD_ADVANCE"),
    accountId: z.string().trim().min(1).max(191),
    amount: advanceMoney,
    cashAccountId: z.string().trim().min(1).max(191),
    method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"]),
    paidAt: z.string().datetime(),
    note: optionalText,
  }).strict(),
]);
export type BuyerFinanceInput = z.infer<typeof buyerFinanceSchema>;

export const saleCorrectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("RETURN"),
    reason: z.string().trim().min(5).max(500),
    note: optionalText,
    allocations: z.array(z.object({ lotId: z.string().trim().min(1).max(191), grams: saleGrams }).strict()).min(1).max(50),
  }).strict(),
  z.object({
    type: z.literal("REVERSAL"),
    reason: z.string().trim().min(5).max(500),
    note: optionalText,
  }).strict(),
]);
export type SaleCorrectionInput = z.infer<typeof saleCorrectionSchema>;

const inventoryKg = z.string().trim()
  .regex(/^\d{1,6}(?:\.\d{1,8})?$/, "Enter kilograms with up to 8 decimal places")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Weight must be greater than zero");
const inventoryGrams = z.string().trim()
  .regex(/^\d{1,11}(?:\.\d{1,5})?$/, "Enter grams with up to 5 decimal places")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Weight must be greater than zero");
const inventoryMoneyRate = z.string().trim()
  .regex(/^\d{1,8}(?:\.\d{1,6})?$/, "Enter a cost per gram with up to 6 decimal places")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, "Cost cannot be negative");
const inventoryLocation = z.string().trim().min(2).max(120);
const inventoryReason = z.string().trim().min(5).max(500);

export const inventoryMovementSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("OPENING"),
    batchNumber: z.string().trim().max(120).optional().or(z.literal("")),
    source: z.string().trim().min(2).max(160),
    receivedAt: z.string().datetime(),
    quantityKg: inventoryKg,
    pounds: z.string().trim().regex(/^\d{1,9}(?:\.\d{1,8})?$/).optional().or(z.literal("")),
    density: z.string().trim().regex(/^\d{1,12}(?:\.\d{1,8})?$/).optional().or(z.literal("")),
    purityBps: z.coerce.number().int().min(1).max(10000),
    costPerGram: inventoryMoneyRate,
    storageLocation: inventoryLocation,
    reason: inventoryReason,
  }).strict(),
  z.object({
    action: z.literal("ADJUST"),
    lotId: z.string().trim().min(1).max(191),
    direction: z.enum(["IN", "OUT"]),
    quantityGrams: inventoryGrams,
    reason: inventoryReason,
  }).strict(),
  z.object({
    action: z.literal("TRANSFER"),
    lotId: z.string().trim().min(1).max(191),
    quantityGrams: inventoryGrams,
    destinationLocation: inventoryLocation,
    reason: inventoryReason,
  }).strict(),
  z.object({
    action: z.literal("RECONCILE"),
    lotId: z.string().trim().min(1).max(191),
    countedGrams: z.string().trim().regex(/^\d{1,11}(?:\.\d{1,5})?$/)
      .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, "Counted stock cannot be negative"),
    reason: inventoryReason,
  }).strict(),
]);
export type InventoryMovementInput = z.infer<typeof inventoryMovementSchema>;

const receivingWeightGrams = z.string().trim()
  .regex(/^\d{1,6}(?:\.\d{1,8})?$/, "Enter a weight with up to 8 decimal places")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Weight must be greater than zero");
const receivingPayment = z.string().trim()
  .regex(/^\d{1,14}(?:\.\d{1,2})?$/, "Enter an amount with up to 2 decimal places")
  .refine((value) => Number.isFinite(Number(value)), "Enter a finite amount");

export const receivingSchema = z.object({
  action: z.enum(["DRAFT", "COMPLETE"]),
  customerId: z.string().trim().min(1).max(191),
  transactionDate: z.string().datetime(),
  topGrams: receivingWeightGrams,
  downGrams: receivingWeightGrams,
  boardPriceId: z.string().trim().min(1).max(191),
  amountPaid: receivingPayment.default("0"),
  financingAccountId: z.string().trim().max(191).optional().or(z.literal("")),
  cashAccountId: z.string().trim().optional().or(z.literal("")),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"]).default("CASH"),
  batchNumber: z.string().trim().max(120).optional().or(z.literal("")),
  storageLocation: inventoryLocation.default("Main storage"),
  note: optionalText,
  supportingDocumentRef: z.string().trim().max(1000).optional().or(z.literal("")),
}).strict()
  .refine((data) => data.action !== "COMPLETE" || Number(data.amountPaid) === 0 || Boolean(data.cashAccountId), {
    message: "Select the account used for the initial payment",
    path: ["cashAccountId"],
  })
  .refine((data) => !data.financingAccountId || data.action === "COMPLETE", {
    message: "Buyer financing can only be applied when completing a purchase",
    path: ["financingAccountId"],
  })
  .refine((data) => !data.financingAccountId || Number(data.amountPaid) === 0, {
    message: "Do not enter a cash payment when applying buyer financing",
    path: ["amountPaid"],
  });
export type ReceivingInput = z.infer<typeof receivingSchema>;

export const paymentSchema = z.object({
  tradeId: z.string().trim().optional().or(z.literal("")),
  customerId: z.string().trim().optional().or(z.literal("")),
  cashAccountId: z.string().trim().optional().or(z.literal("")),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  amount: positiveAmount.max(100000000000),
  method: z.enum(["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "OTHER"]),
  paidAt: z.string().datetime().optional(),
  note: optionalText,
}).strict().refine((data) => Boolean(data.tradeId), {
  message: "Select a trade to allocate this payment to",
  path: ["tradeId"],
});

export const financeAccountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(["CASH", "BANK", "MOBILE_MONEY"]),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default("GHS"),
  institution: z.string().trim().max(120).optional().or(z.literal("")),
  accountReference: z.string().trim().max(120).optional().or(z.literal("")),
  openingBalance: z.string().trim().regex(/^\d{1,14}(?:\.\d{1,2})?$/).default("0"),
  openingDate: z.string().datetime(),
}).strict();

export const financeMovementSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("TRANSFER"),
    fromAccountId: z.string().trim().min(1).max(191),
    toAccountId: z.string().trim().min(1).max(191),
    amount: z.string().trim().regex(/^\d{1,14}(?:\.\d{1,2})?$/)
      .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0),
    movementDate: z.string().datetime(),
    description: z.string().trim().min(5).max(500),
  }).strict(),
  z.object({
    action: z.literal("ADJUST"),
    accountId: z.string().trim().min(1).max(191),
    direction: z.enum(["INBOUND", "OUTBOUND"]),
    amount: z.string().trim().regex(/^\d{1,14}(?:\.\d{1,2})?$/)
      .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0),
    movementDate: z.string().datetime(),
    description: z.string().trim().min(5).max(500),
  }).strict(),
]);

export const financeSettingsSchema = z.object({
  adjustmentApprovalThreshold: z.string().trim().regex(/^(?:\d{1,14}(?:\.\d{1,2})?)?$/).default(""),
}).strict();

const formulaDecimal = z.string().trim().regex(/^\d{1,8}(?:\.\d{1,8})?$/);

export const purchaseFormulaSettingsSchema = z.object({
  ownerConfirmed: z.boolean(),
  poundsKgDivisor: formulaDecimal.refine((value) => Number(value) > 0, "Pounds divisor must be greater than zero"),
  densityReference: formulaDecimal.refine((value) => Number(value) > 0, "Density reference must be greater than zero"),
  karatMultiplier: formulaDecimal.refine((value) => Number(value) > 0, "Karat multiplier must be greater than zero"),
  karatDiscountMultiplier: formulaDecimal.refine(
    (value) => Number(value) > 0 && Number(value) <= 1,
    "Karat discount multiplier must be greater than zero and at most one",
  ),
  amountKaratDivisor: formulaDecimal.refine((value) => Number(value) > 0, "Amount divisor must be greater than zero"),
}).strict();

export const boardPriceSchema = z.object({
  priceType: z.enum(["RECEIVING", "SELLING"]),
  priceAmount: z.string().trim()
    .regex(/^\d{1,12}(?:\.\d{1,6})?$/, "Enter a positive amount with up to 6 decimal places")
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Price amount must be greater than zero"),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase currency code"),
  priceUnit: z.string().trim().min(2).max(80),
  source: z.string().trim().min(2).max(80),
  note: optionalText,
  effectiveAt: z.string().datetime().refine((value) => new Date(value) <= new Date(), "A board price cannot be effective in the future").optional(),
  expectedCurrentPriceId: z.string().trim().max(191).nullable(),
}).strict();

export const staffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(40),
  role: z.enum(["OWNER", "MANAGER", "GOLD_RECEIVER", "SALES_OFFICER", "INVENTORY_OFFICER", "TRADER", "ACCOUNTANT", "AUDITOR", "VIEWER"]).default("TRADER"),
  permissions: z.array(z.string().trim().min(3).max(80)).max(64).optional(),
}).strict();

export const ownerCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(6).max(40),
  password: z.string().min(12).max(128),
  confirmPassword: z.string().min(12).max(128),
}).strict().refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export const staffUpdateSchema = z.object({
  role: z.enum(["OWNER", "MANAGER", "GOLD_RECEIVER", "SALES_OFFICER", "INVENTORY_OFFICER", "TRADER", "ACCOUNTANT", "AUDITOR", "VIEWER"]).optional(),
  permissions: z.array(z.string().trim().min(3).max(80)).max(64).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((data) => data.role !== undefined || data.permissions !== undefined || data.isActive !== undefined);
