CREATE TABLE `GoldSaleMeasurement` (
    `id` VARCHAR(191) NOT NULL,
    `tradeId` VARCHAR(191) NOT NULL,
    `topGrams` DECIMAL(16, 8) NOT NULL,
    `downGrams` DECIMAL(16, 8) NOT NULL,
    `pounds` DECIMAL(16, 8) NOT NULL,
    `density` DECIMAL(24, 8) NOT NULL,
    `karat` DECIMAL(16, 8) NOT NULL,
    `formulaVersion` VARCHAR(40) NOT NULL,
    `formulaInputs` JSON NOT NULL,
    `calculationSource` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `GoldSaleMeasurement_tradeId_key`(`tradeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `GoldSaleMeasurement`
    ADD CONSTRAINT `GoldSaleMeasurement_tradeId_fkey`
    FOREIGN KEY (`tradeId`) REFERENCES `Trade`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
