CREATE TABLE `PurchaseFormulaConfig` (
  `id` VARCHAR(191) NOT NULL DEFAULT 'default',
  `version` VARCHAR(40) NOT NULL,
  `ownerConfirmed` BOOLEAN NOT NULL DEFAULT false,
  `poundsKgDivisor` DECIMAL(16, 8) NOT NULL,
  `densityReference` DECIMAL(16, 8) NOT NULL,
  `karatMultiplier` DECIMAL(16, 8) NOT NULL,
  `amountKaratAdjustment` DECIMAL(16, 8) NOT NULL,
  `amountKaratDivisor` DECIMAL(16, 8) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
