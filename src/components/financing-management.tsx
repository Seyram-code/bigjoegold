"use client";

import { useState } from "react";
import { Coins, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BuyerFinancingManagement } from "@/components/buyer-financing-management";
import { CustomerAdvancesManagement } from "@/components/customer-advances-management";

type FinancingTab = "customer-advances" | "buyer-financing";

export function FinancingManagement({
  canWrite,
  canCreateCustomer,
  canFulfill,
  initialTab = "customer-advances",
}: {
  canWrite: boolean;
  canCreateCustomer: boolean;
  canFulfill: boolean;
  initialTab?: FinancingTab;
}) {
  const [activeTab, setActiveTab] = useState<FinancingTab>(initialTab);

  return <div className="space-y-4">
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-[#17212f]">Financing</h1>
      <p className="mt-1 text-sm text-[#637083]">Manage supplier gold advances and customer gold financing.</p>
    </div>
    <div className="flex flex-wrap gap-2 border-b border-[#e7ebef] pb-3" role="tablist" aria-label="Financing types">
      <Button
        id="supplier-gold-advances-tab"
        type="button"
        role="tab"
        aria-selected={activeTab === "customer-advances"}
        aria-controls="financing-panel"
        variant={activeTab === "customer-advances" ? "gold" : "outline"}
        onClick={() => setActiveTab("customer-advances")}
      >
        <WalletCards size={15} /> Supplier Gold Advances
      </Button>
      <Button
        id="customer-gold-financing-tab"
        type="button"
        role="tab"
        aria-selected={activeTab === "buyer-financing"}
        aria-controls="financing-panel"
        variant={activeTab === "buyer-financing" ? "gold" : "outline"}
        onClick={() => setActiveTab("buyer-financing")}
      >
        <Coins size={15} /> Customer Gold Financing
      </Button>
    </div>
    <section id="financing-panel" role="tabpanel" aria-labelledby={activeTab === "customer-advances" ? "supplier-gold-advances-tab" : "customer-gold-financing-tab"}>
      {activeTab === "customer-advances"
        ? <CustomerAdvancesManagement canWrite={canWrite} canCreateCustomer={canCreateCustomer} canFulfill={canFulfill} />
        : <BuyerFinancingManagement canWrite={canWrite} />}
    </section>
  </div>;
}
