CREATE TABLE `BuyerFinanceAccount` (
  `id` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `BuyerFinanceAccount_reference_key`(`reference`),
  INDEX `BuyerFinanceAccount_customerId_createdAt_idx`(`customerId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BuyerFinanceSettlement` (
  `id` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `accountId` VARCHAR(191) NOT NULL,
  `tradeId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(16, 2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `BuyerFinanceSettlement_reference_key`(`reference`),
  UNIQUE INDEX `BuyerFinanceSettlement_tradeId_key`(`tradeId`),
  INDEX `BuyerFinanceSettlement_accountId_createdAt_idx`(`accountId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Payment`
  ADD COLUMN `buyerFinanceAccountId` VARCHAR(191) NULL,
  ADD INDEX `Payment_buyerFinanceAccountId_paidAt_idx`(`buyerFinanceAccountId`, `paidAt`);

ALTER TABLE `BuyerFinanceAccount`
  ADD CONSTRAINT `BuyerFinanceAccount_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `BuyerFinanceAccount_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `BuyerFinanceSettlement`
  ADD CONSTRAINT `BuyerFinanceSettlement_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `BuyerFinanceAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `BuyerFinanceSettlement_tradeId_fkey` FOREIGN KEY (`tradeId`) REFERENCES `Trade`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `BuyerFinanceSettlement_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Payment`
  ADD CONSTRAINT `Payment_buyerFinanceAccountId_fkey` FOREIGN KEY (`buyerFinanceAccountId`) REFERENCES `BuyerFinanceAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
