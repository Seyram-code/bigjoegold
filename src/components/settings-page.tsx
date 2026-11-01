"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldControlClass, FormField } from "@/components/ui/form-field";
import { DEFAULT_PURCHASE_FORMULA_RULES, MAX_PURCHASE_KARAT, type PurchaseFormulaRules } from "@/lib/purchase-formula";
import { useToast } from "@/components/ui/toast-provider";

const settings = [
  { label: "Reporting currency", value: "Ghana cedi (GHS)", description: "Financial amounts are displayed in Ghana cedis." },
  { label: "Gold weight unit", value: "Kilograms", description: "Trade quantities are entered in kilograms and inventory is tracked in grams." },
  { label: "Gold valuation basis", value: "Pure grams", description: "Trade values use gross weight, recorded purity, and the agreed GHS-per-pure-gram rate." },
  { label: "Inventory costing", value: "FIFO", description: "Sales consume available purchase lots in first-in, first-out order." },
];

function errorMessage(body: unknown, fallback: string) {
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

export function SettingsPage() {
  const [formula, setFormula] = useState<PurchaseFormulaRules>(DEFAULT_PURCHASE_FORMULA_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { success: showToast } = useToast();

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setError("");
      try {
        const response = await fetch("/api/settings/purchase-formula", { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(errorMessage(body, "Unable to load purchase formulas"));
        setFormula(body as PurchaseFormulaRules);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load purchase formulas");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  function updateFormula<K extends keyof PurchaseFormulaRules>(field: K, value: PurchaseFormulaRules[K]) {
    setFormula((current) => ({ ...current, [field]: value, ...(field === "ownerConfirmed" ? {} : { ownerConfirmed: false }) }));
  }

  async function saveFormula(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/settings/purchase-formula", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerConfirmed: formula.ownerConfirmed,
          poundsKgDivisor: formula.poundsKgDivisor,
          densityReference: formula.densityReference,
          karatMultiplier: formula.karatMultiplier,
          karatDiscountMultiplier: formula.karatDiscountMultiplier,
          amountKaratDivisor: formula.amountKaratDivisor,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body, "Unable to save purchase formulas"));
      setFormula(body as PurchaseFormulaRules);
      showToast(`Purchase formulas saved as ${String((body as PurchaseFormulaRules).version)}${(body as PurchaseFormulaRules).ownerConfirmed ? " and confirmed." : ". Purchase completion remains disabled until confirmed."}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save purchase formulas");
    } finally {
      setSaving(false);
    }
  }

  return <div className="space-y-5">
    <div>
      <p className="text-xs font-medium text-[#8b949e]">Workspace / Settings</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17212f]">Settings</h1>
      <p className="mt-1.5 max-w-2xl text-sm text-[#76808c]">Review and manage the business rules used by the trading workspace.</p>
    </div>

    <AlertDialog open={Boolean(error)} title="Settings error" description={error} onConfirm={() => setError("")} />

    <Card>
      <CardHeader>
        <CardTitle>Purchase calculation formulas</CardTitle>
        <p className="text-xs leading-5 text-[#76808c]">These saved server-side rules calculate receiving measurements and purchase values. Formula version: <strong>{formula.version}</strong>. Changes are recorded in the audit log and apply to new calculations; existing transactions are not recalculated.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={saveFormula} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <FormField label="Pounds divisor (Top weight in grams ÷ value)" htmlFor="formula-pounds-divisor" hint="Default: 7.75">
              <input id="formula-pounds-divisor" type="number" min="0.00000001" step="0.00000001" required value={formula.poundsKgDivisor} onChange={(event) => updateFormula("poundsKgDivisor", event.target.value)} className={fieldControlClass} disabled={loading || saving} />
            </FormField>
            <FormField label="Density reference" htmlFor="formula-density-reference" hint="Subtracted from density before karat multiplication. Default: 10.51">
              <input id="formula-density-reference" type="number" min="0.00000001" step="0.00000001" required value={formula.densityReference} onChange={(event) => updateFormula("densityReference", event.target.value)} className={fieldControlClass} disabled={loading || saving} />
            </FormField>
            <FormField label="Karat multiplier" htmlFor="formula-karat-multiplier" hint="Default: 52.838">
              <input id="formula-karat-multiplier" type="number" min="0.00000001" step="0.00000001" required value={formula.karatMultiplier} onChange={(event) => updateFormula("karatMultiplier", event.target.value)} className={fieldControlClass} disabled={loading || saving} />
            </FormField>
            <FormField label="Karat discount multiplier" htmlFor="formula-karat-discount" hint="Applied after base karat is truncated to 2 decimal places; result is then truncated to 2 decimals. Default: 0.993 (0.7% discount).">
              <input id="formula-karat-discount" type="number" min="0.00000001" max="1" step="0.00000001" required value={formula.karatDiscountMultiplier} onChange={(event) => updateFormula("karatDiscountMultiplier", event.target.value)} className={fieldControlClass} disabled={loading || saving} />
            </FormField>
            <FormField label="Amount karat divisor" htmlFor="formula-amount-divisor" hint="Default: 23">
              <input id="formula-amount-divisor" type="number" min="0.00000001" step="0.00000001" required value={formula.amountKaratDivisor} onChange={(event) => updateFormula("amountKaratDivisor", event.target.value)} className={fieldControlClass} disabled={loading || saving} />
            </FormField>
            <FormField label="Required board-price unit" htmlFor="formula-price-unit" hint="Board prices must use this unit to be selectable.">
              <input id="formula-price-unit" value={formula.priceUnit} readOnly className={`${fieldControlClass} bg-[#f7f8fa]`} />
            </FormField>
          </div>

          <div className="rounded-lg border border-[#e8ebef] bg-[#fafbfc] p-4 text-xs leading-6 text-[#586575]">
            <p className="font-semibold text-[#253243]">Formula applied</p>
            <p>Pounds = Top weight in grams ÷ {formula.poundsKgDivisor}, truncated to 2 decimal places.</p>
            <p>Density = Top weight in grams ÷ Down weight in grams, truncated to 2 decimal places.</p>
            <p>Base karat = ((Density − {formula.densityReference}) × {formula.karatMultiplier} ÷ Density), truncated to 2 decimal places before the discount.</p>
            <p>Karat used = Base karat × {formula.karatDiscountMultiplier}, truncated to 2 decimal places.</p>
            <p>Validation: karat must be at most {MAX_PURCHASE_KARAT}. Higher readings are rejected for review rather than capped.</p>
            <p>Purity = Karat ÷ 24 × 100</p>
            <p>Purchase amount = Pounds × board price × Karat ÷ {formula.amountKaratDivisor}, rounded to GHS pesewas.</p>
            <p>Board-price unit: {formula.priceUnit}</p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <input type="checkbox" checked={formula.ownerConfirmed} onChange={(event) => updateFormula("ownerConfirmed", event.target.checked)} disabled={loading || saving} className="mt-0.5 size-4 accent-[#bc8c36]" />
            <span><strong>I have reviewed and confirm these purchase formulas and units.</strong><span className="mt-1 block text-xs leading-5">Confirming enables purchase completion using the rules above. Editing a formula automatically removes its confirmation until re-approved.</span></span>
          </label>
          {!formula.ownerConfirmed && <AlertDialog open title="Purchase formulas need approval" variant="warning" description="Purchase completion remains disabled until an administrator reviews and confirms these formulas. Any formula edit removes the previous confirmation." onConfirm={() => {}} />}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="gold" disabled={loading || saving}>{saving ? "Saving…" : "Save purchase formulas"}</Button>
            <span className="text-xs text-[#76808c]">{loading ? "Loading saved formulas…" : formula.ownerConfirmed ? "Confirmed; purchase completion is enabled." : "Unconfirmed; purchases can be saved as drafts only."}</span>
          </div>
        </form>
      </CardContent>
    </Card>

    <div className="grid gap-4 md:grid-cols-2">
      {settings.map((setting) => <Card key={setting.label}>
        <CardHeader className="pb-2"><CardTitle>{setting.label}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm font-semibold text-[#17212f]">{setting.value}</p>
          <p className="mt-1 text-xs leading-5 text-[#76808c]">{setting.description}</p>
        </CardContent>
      </Card>)}
    </div>
  </div>;
}
