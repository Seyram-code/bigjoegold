import { Prisma } from "@prisma/client";

const zero = () => new Prisma.Decimal(0);
type DecimalInput = Prisma.Decimal | string | number;

export function calculateReceivedMeasurementTotals(
  purchases: {
    quantityKg: DecimalInput;
    purityBps: number;
    measurement: {
      pounds: DecimalInput;
      density: DecimalInput;
      karat: DecimalInput;
      downKg: DecimalInput;
    } | null;
  }[],
) {
  const totals = purchases.reduce((result, purchase) => {
    const grams = new Prisma.Decimal(purchase.quantityKg).mul(1000);
    result.grams = result.grams.plus(grams);
    if (purchase.measurement) {
      result.pounds = result.pounds.plus(purchase.measurement.pounds);
      result.downGrams = result.downGrams.plus(new Prisma.Decimal(purchase.measurement.downKg).mul(1000));
      result.densityWeight = result.densityWeight.plus(new Prisma.Decimal(purchase.measurement.density).mul(grams));
      result.densityGrams = result.densityGrams.plus(grams);
      result.karatWeight = result.karatWeight.plus(new Prisma.Decimal(purchase.measurement.karat).mul(grams));
    } else {
      result.karatWeight = result.karatWeight.plus(
        new Prisma.Decimal(purchase.purityBps).mul(24).div(10000).mul(grams),
      );
    }
    return result;
  }, {
    grams: zero(),
    pounds: zero(),
    downGrams: zero(),
    densityWeight: zero(),
    densityGrams: zero(),
    karatWeight: zero(),
  });

  return {
    pounds: totals.pounds.toNumber(),
    downGrams: totals.downGrams.toNumber(),
    density: totals.densityGrams.isZero() ? null : totals.densityWeight.div(totals.densityGrams).toNumber(),
    karat: totals.grams.isZero() ? null : totals.karatWeight.div(totals.grams).toNumber(),
  };
}

export function calculateSoldDownWeight(
  sales: {
    quantityKg: DecimalInput;
    measurement: { topGrams: DecimalInput; downGrams: DecimalInput } | null;
    returnedGrams: DecimalInput;
  }[],
) {
  const totalDownGrams = sales.reduce((total, sale) => {
    if (!sale.measurement) return total;
    const topGrams = new Prisma.Decimal(sale.measurement.topGrams);
    if (!topGrams.isFinite() || !topGrams.greaterThan(0)) return total;
    const soldGrams = Prisma.Decimal.max(
      zero(),
      new Prisma.Decimal(sale.quantityKg).mul(1000).minus(sale.returnedGrams),
    );
    return total.plus(new Prisma.Decimal(sale.measurement.downGrams).mul(soldGrams).div(topGrams));
  }, zero());
  return totalDownGrams.toNumber();
}

export function calculateInventoryAverageKarat(
  lots: { grams: Prisma.Decimal | string | number; purityBps: number }[],
) {
  const totals = lots.reduce((result, lot) => {
    const grams = new Prisma.Decimal(lot.grams);
    result.grams = result.grams.plus(grams);
    result.karatWeight = result.karatWeight.plus(new Prisma.Decimal(lot.purityBps).mul(24).div(10000).mul(grams));
    return result;
  }, { grams: zero(), karatWeight: zero() });
  return totals.grams.isZero() ? null : totals.karatWeight.div(totals.grams).toNumber();
}

export function calculateAvailableInventoryMeasurementTotals(
  lots: {
    grams: DecimalInput;
    originalGrams: DecimalInput;
    purityBps: number;
    pounds: DecimalInput | null;
    density: DecimalInput | null;
    measurement: {
      topKg: DecimalInput;
      downKg: DecimalInput;
      pounds: DecimalInput;
      density: DecimalInput;
      karat: DecimalInput;
    } | null;
  }[],
) {
  const totals = lots.reduce((result, lot) => {
    const grams = new Prisma.Decimal(lot.grams);
    const originalGrams = new Prisma.Decimal(lot.originalGrams);
    if (!originalGrams.greaterThan(0) || !grams.greaterThan(0)) return result;
    const remainingShare = grams.div(originalGrams);
    const measurement = lot.measurement;
    result.topGrams = result.topGrams.plus(
      (measurement ? new Prisma.Decimal(measurement.topKg).mul(1000) : originalGrams).mul(remainingShare),
    );
    if (measurement) {
      result.downGrams = result.downGrams.plus(new Prisma.Decimal(measurement.downKg).mul(1000).mul(remainingShare));
    }

    const pounds = measurement?.pounds ?? lot.pounds;
    if (pounds !== null) result.pounds = result.pounds.plus(new Prisma.Decimal(pounds).mul(remainingShare));

    const density = measurement?.density ?? lot.density;
    if (density !== null) {
      result.densityWeight = result.densityWeight.plus(new Prisma.Decimal(density).mul(grams));
      result.densityGrams = result.densityGrams.plus(grams);
    }

    const karat = measurement?.karat ?? new Prisma.Decimal(lot.purityBps).mul(24).div(10000);
    result.karatWeight = result.karatWeight.plus(new Prisma.Decimal(karat).mul(grams));
    result.grams = result.grams.plus(grams);
    return result;
  }, {
    topGrams: zero(),
    downGrams: zero(),
    pounds: zero(),
    densityWeight: zero(),
    densityGrams: zero(),
    karatWeight: zero(),
    grams: zero(),
  });

  return {
    topGrams: totals.topGrams.toNumber(),
    downGrams: totals.downGrams.toNumber(),
    pounds: totals.pounds.toNumber(),
    density: totals.densityGrams.isZero() ? null : totals.densityWeight.div(totals.densityGrams).toNumber(),
    karat: totals.grams.isZero() ? null : totals.karatWeight.div(totals.grams).toNumber(),
  };
}
