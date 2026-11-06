const GRAM_UNITS = BigInt(100_000);

type AllocationInput = { lotId: string; grams: string };
type AvailableLot = { id: string; remainingGrams: string | number };

function gramsToUnits(value: string | number, label: string) {
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,5}))?$/.exec(text);
  if (!match) throw new RangeError(`${label} must use no more than 5 decimal places`);
  const [, whole, fraction = ""] = match;
  return BigInt(whole) * GRAM_UNITS + BigInt(fraction.padEnd(5, "0"));
}

function unitsToGrams(units: bigint) {
  const whole = units / GRAM_UNITS;
  const fraction = String(units % GRAM_UNITS).padStart(5, "0");
  return `${whole}.${fraction}`;
}

function distributeProportionally(total: bigint, weights: bigint[], caps: bigint[]) {
  const result = weights.map(() => BigInt(0));
  let remaining = total;
  let active = weights.map((_, index) => index).filter((index) => weights[index] > BigInt(0) && caps[index] > BigInt(0));

  while (remaining > BigInt(0) && active.length) {
    const weightTotal = active.reduce((sum, index) => sum + weights[index], BigInt(0));
    const shares = active.map((index) => {
      const numerator = remaining * weights[index];
      return { index, units: numerator / weightTotal, remainder: numerator % weightTotal, numerator };
    });
    const saturated = shares.filter((share) => share.numerator > caps[share.index] * weightTotal);
    if (saturated.length) {
      for (const share of saturated) {
        result[share.index] = caps[share.index];
        remaining -= caps[share.index];
      }
      const saturatedIndexes = new Set(saturated.map((share) => share.index));
      active = active.filter((index) => !saturatedIndexes.has(index));
      continue;
    }

    for (const share of shares) result[share.index] = share.units;
    let remainder = remaining - shares.reduce((sum, share) => sum + share.units, BigInt(0));
    for (const share of shares.sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
      if (remainder === BigInt(0)) break;
      if (result[share.index] < caps[share.index]) {
        result[share.index] += BigInt(1);
        remainder -= BigInt(1);
      }
    }
    if (remainder > BigInt(0)) throw new RangeError("Unable to distribute the requested weight across selected batches");
    remaining = BigInt(0);
  }
  if (remaining > BigInt(0)) throw new RangeError("Unable to distribute the requested weight across selected batches");
  return result;
}

export function adjustSaleAllocations(
  allocations: AllocationInput[],
  availableLots: AvailableLot[],
  targetGrams: string,
) {
  const targetUnits = gramsToUnits(targetGrams, "Top weight");
  if (targetUnits <= BigInt(0)) throw new RangeError("Top weight must be greater than zero");
  if (!allocations.length) throw new RangeError("Add at least one stock batch before applying measurements");

  const lotsById = new Map(availableLots.map((lot) => [lot.id, gramsToUnits(lot.remainingGrams, "Available batch weight")]));
  const currentUnits = allocations.map((allocation) => gramsToUnits(allocation.grams, "Allocated batch weight"));
  const caps = allocations.map((allocation) => {
    const available = lotsById.get(allocation.lotId);
    if (available === undefined) throw new RangeError("A selected stock batch is no longer available");
    return available;
  });
  if (currentUnits.some((units, index) => units > caps[index])) {
    throw new RangeError("An allocated batch weight exceeds its available stock");
  }

  const currentTotal = currentUnits.reduce((sum, units) => sum + units, BigInt(0));
  if (targetUnits === currentTotal) return allocations;

  if (targetUnits < currentTotal) {
    const nextUnits = distributeProportionally(targetUnits, currentUnits, currentUnits);
    return allocations.flatMap((allocation, index) => nextUnits[index] > BigInt(0)
      ? [{ ...allocation, grams: unitsToGrams(nextUnits[index]) }]
      : []);
  }

  const totalCapacity = caps.reduce((sum, cap) => sum + cap, BigInt(0));
  if (targetUnits > totalCapacity) {
    throw new RangeError("The top weight exceeds the available stock in the selected batches");
  }
  const nextUnits = distributeProportionally(targetUnits, currentUnits, caps);
  return allocations.map((allocation, index) => ({
    ...allocation,
    grams: unitsToGrams(nextUnits[index]),
  }));
}
