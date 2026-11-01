CREATE TABLE `CustomerAdvance` (
  `id` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `CustomerAdvance_reference_key`(`reference`),
  INDEX `CustomerAdvance_customerId_createdAt_idx`(`customerId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CustomerAdvanceRequest` (
  `id` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `advanceId` VARCHAR(191) NOT NULL,
  `requestedGrams` DECIMAL(16, 5) NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `CustomerAdvanceRequest_reference_key`(`reference`),
  INDEX `CustomerAdvanceRequest_advanceId_createdAt_idx`(`advanceId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AdvanceFulfillment` (
  `id` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `requestId` VARCHAR(191) NOT NULL,
  `tradeId` VARCHAR(191) NOT NULL,
  `boardPriceId` VARCHAR(191) NOT NULL,
  `grams` DECIMAL(16, 5) NOT NULL,
  `amount` DECIMAL(16, 2) NOT NULL,
  `pricePerGram` DECIMAL(18, 6) NOT NULL,
  `purityBps` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `AdvanceFulfillment_reference_key`(`reference`),
  UNIQUE INDEX `AdvanceFulfillment_tradeId_key`(`tradeId`),
  INDEX `AdvanceFulfillment_requestId_createdAt_idx`(`requestId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Payment`
  ADD COLUMN `customerAdvanceId` VARCHAR(191) NULL,
  ADD COLUMN `referencePricePerGram` DECIMAL(18, 6) NULL,
  ADD COLUMN `referencePriceSource` VARCHAR(80) NULL,
  ADD COLUMN `referencePriceEffectiveAt` DATETIME(3) NULL,
  ADD INDEX `Payment_customerAdvanceId_paidAt_idx`(`customerAdvanceId`, `paidAt`);

ALTER TABLE `StockMovement`
  ADD COLUMN `advanceFulfillmentId` VARCHAR(191) NULL,
  ADD INDEX `StockMovement_advanceFulfillmentId_idx`(`advanceFulfillmentId`);

ALTER TABLE `CustomerAdvance`
  ADD CONSTRAINT `CustomerAdvance_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CustomerAdvance_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CustomerAdvanceRequest`
  ADD CONSTRAINT `CustomerAdvanceRequest_advanceId_fkey` FOREIGN KEY (`advanceId`) REFERENCES `CustomerAdvance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CustomerAdvanceRequest_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `AdvanceFulfillment`
  ADD CONSTRAINT `AdvanceFulfillment_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `CustomerAdvanceRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `AdvanceFulfillment_tradeId_fkey` FOREIGN KEY (`tradeId`) REFERENCES `Trade`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `AdvanceFulfillment_boardPriceId_fkey` FOREIGN KEY (`boardPriceId`) REFERENCES `GoldBoardPrice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `AdvanceFulfillment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Payment`
  ADD CONSTRAINT `Payment_customerAdvanceId_fkey` FOREIGN KEY (`customerAdvanceId`) REFERENCES `CustomerAdvance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `StockMovement`
  ADD CONSTRAINT `StockMovement_advanceFulfillmentId_fkey` FOREIGN KEY (`advanceFulfillmentId`) REFERENCES `AdvanceFulfillment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
