CREATE TABLE `InventoryReconciliation` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `activeKey` VARCHAR(16) NULL,
    `status` ENUM('IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'IN_PROGRESS',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `closedById` VARCHAR(191) NULL,

    UNIQUE INDEX `InventoryReconciliation_reference_key`(`reference`),
    UNIQUE INDEX `InventoryReconciliation_activeKey_key`(`activeKey`),
    INDEX `InventoryReconciliation_status_startedAt_idx`(`status`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryReconciliationLine` (
    `id` VARCHAR(191) NOT NULL,
    `reconciliationId` VARCHAR(191) NOT NULL,
    `inventoryLotId` VARCHAR(191) NOT NULL,
    `batchNumber` VARCHAR(120) NOT NULL,
    `locationName` VARCHAR(120) NOT NULL,
    `expectedGrams` DECIMAL(16, 5) NOT NULL,
    `countedGrams` DECIMAL(16, 5) NULL,
    `varianceGrams` DECIMAL(16, 5) NOT NULL DEFAULT 0,
    `costPerGram` DECIMAL(14, 6) NOT NULL,
    `reason` TEXT NULL,
    `correctionRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventoryReconciliationLine_reconciliationId_inventoryLotId_key`(`reconciliationId`, `inventoryLotId`),
    INDEX `InventoryReconciliationLine_reconciliationId_countedGrams_idx`(`reconciliationId`, `countedGrams`),
    UNIQUE INDEX `InventoryReconciliationLine_correctionRef_key`(`correctionRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `InventoryReconciliation`
    ADD CONSTRAINT `InventoryReconciliation_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryReconciliation_closedById_fkey`
    FOREIGN KEY (`closedById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `InventoryReconciliationLine`
    ADD CONSTRAINT `InventoryReconciliationLine_reconciliationId_fkey`
    FOREIGN KEY (`reconciliationId`) REFERENCES `InventoryReconciliation`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryReconciliationLine_inventoryLotId_fkey`
    FOREIGN KEY (`inventoryLotId`) REFERENCES `InventoryLot`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
