import { Prisma } from "@prisma/client";

export function stocktakeVariance(expectedGrams: string | number, countedGrams: string | number, costPerGram: string | number) {
  const variance = new Prisma.Decimal(countedGrams).minus(expectedGrams);
  return {
    varianceGrams: variance,
    costImpact: variance.mul(costPerGram).toDecimalPlaces(2),
  };
}
