ALTER TABLE `Trade`
    MODIFY `status` ENUM('DRAFT', 'POSTED', 'VOIDED') NOT NULL DEFAULT 'POSTED',
    MODIFY `quantityKg` DECIMAL(14, 8) NOT NULL,
    ADD COLUMN `transactionDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `topKg` DECIMAL(14, 8) NULL,
    ADD COLUMN `downKg` DECIMAL(14, 8) NULL,
    ADD COLUMN `pounds` DECIMAL(16, 8) NULL,
    ADD COLUMN `density` DECIMAL(24, 8) NULL,
    ADD COLUMN `karat` DECIMAL(16, 8) NULL,
    ADD COLUMN `formulaVersion` VARCHAR(191) NULL,
    ADD COLUMN `formulaInputs` JSON NULL,
    ADD COLUMN `calculationSource` VARCHAR(191) NULL,
    ADD COLUMN `priceUnit` VARCHAR(191) NOT NULL DEFAULT 'GHS_PER_GRAM_PURE_GOLD',
    ADD COLUMN `boardPriceId` VARCHAR(191) NULL,
    ADD COLUMN `paymentAmount` DECIMAL(16, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `paymentMethod` ENUM('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE', 'OTHER') NOT NULL DEFAULT 'CASH',
    ADD COLUMN `supportingDocumentRef` TEXT NULL,
    ADD INDEX `Trade_boardPriceId_idx`(`boardPriceId`);

ALTER TABLE `InventoryLot`
    MODIFY `originalGrams` DECIMAL(16, 5) NOT NULL,
    MODIFY `remainingGrams` DECIMAL(16, 5) NOT NULL;

ALTER TABLE `InventoryAllocation`
    MODIFY `grams` DECIMAL(16, 5) NOT NULL;

ALTER TABLE `Trade`
    ADD CONSTRAINT `Trade_boardPriceId_fkey`
    FOREIGN KEY (`boardPriceId`) REFERENCES `GoldBoardPrice`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
