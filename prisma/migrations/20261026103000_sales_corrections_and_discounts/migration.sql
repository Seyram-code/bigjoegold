ALTER TABLE `Payment` ADD COLUMN `saleCorrectionId` VARCHAR(191) NULL;

ALTER TABLE `StockMovement`
  ADD COLUMN `correctionId` VARCHAR(191) NULL,
  MODIFY `type` ENUM('PURCHASE_RECEIPT', 'SALE_ISSUE', 'SALE_RETURN') NOT NULL;

ALTER TABLE `Trade`
  ADD COLUMN `discountAmount` DECIMAL(16, 2) NOT NULL DEFAULT 0,
  MODIFY `status` ENUM('DRAFT', 'POSTED', 'RETURNED', 'VOIDED') NOT NULL DEFAULT 'POSTED';

CREATE TABLE `SaleCorrection` (
  `id` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `type` ENUM('RETURN', 'REVERSAL') NOT NULL,
  `tradeId` VARCHAR(191) NOT NULL,
  `quantityGrams` DECIMAL(16, 5) NOT NULL,
  `creditAmount` DECIMAL(16, 2) NOT NULL,
  `refundAmount` DECIMAL(16, 2) NOT NULL,
  `reason` TEXT NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `SaleCorrection_reference_key`(`reference`),
  INDEX `SaleCorrection_tradeId_createdAt_idx`(`tradeId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SaleCorrectionAllocation` (
  `id` VARCHAR(191) NOT NULL,
  `correctionId` VARCHAR(191) NOT NULL,
  `lotId` VARCHAR(191) NOT NULL,
  `grams` DECIMAL(16, 5) NOT NULL,
  INDEX `SaleCorrectionAllocation_correctionId_idx`(`correctionId`),
  INDEX `SaleCorrectionAllocation_lotId_idx`(`lotId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `StockMovement_correctionId_idx` ON `StockMovement`(`correctionId`);

ALTER TABLE `SaleCorrection`
  ADD CONSTRAINT `SaleCorrection_tradeId_fkey` FOREIGN KEY (`tradeId`) REFERENCES `Trade`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SaleCorrection_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SaleCorrectionAllocation`
  ADD CONSTRAINT `SaleCorrectionAllocation_correctionId_fkey` FOREIGN KEY (`correctionId`) REFERENCES `SaleCorrection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `SaleCorrectionAllocation_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `InventoryLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StockMovement`
  ADD CONSTRAINT `StockMovement_correctionId_fkey` FOREIGN KEY (`correctionId`) REFERENCES `SaleCorrection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Payment`
  ADD CONSTRAINT `Payment_saleCorrectionId_fkey` FOREIGN KEY (`saleCorrectionId`) REFERENCES `SaleCorrection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
