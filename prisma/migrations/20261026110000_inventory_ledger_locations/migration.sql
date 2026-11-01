ALTER TABLE `InventoryLot` DROP FOREIGN KEY `InventoryLot_tradeId_fkey`;
ALTER TABLE `StockMovement` DROP FOREIGN KEY `StockMovement_tradeId_fkey`;

ALTER TABLE `InventoryLot`
  ADD COLUMN `batchNumber` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `density` DECIMAL(24, 8) NULL,
  ADD COLUMN `pounds` DECIMAL(16, 8) NULL,
  ADD COLUMN `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT '',
  ADD COLUMN `status` ENUM('ACTIVE', 'DEPLETED', 'QUARANTINED') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `storageLocationId` VARCHAR(191) NULL,
  MODIFY `tradeId` VARCHAR(191) NULL;

ALTER TABLE `StockMovement`
  ADD COLUMN `fromLocationId` VARCHAR(191) NULL,
  ADD COLUMN `locationId` VARCHAR(191) NULL,
  ADD COLUMN `reason` TEXT NULL,
  ADD COLUMN `toLocationId` VARCHAR(191) NULL,
  ADD COLUMN `transferReference` VARCHAR(191) NULL,
  MODIFY `type` ENUM('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'SALE_ISSUE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'STOCK_CORRECTION_IN', 'STOCK_CORRECTION_OUT') NOT NULL,
  MODIFY `tradeId` VARCHAR(191) NULL;

ALTER TABLE `Trade`
  ADD COLUMN `inventoryBatchNumber` VARCHAR(191) NULL,
  ADD COLUMN `storageLocationName` VARCHAR(191) NULL;

CREATE TABLE `StorageLocation` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `StorageLocation_name_key`(`name`),
  INDEX `StorageLocation_isActive_name_idx`(`isActive`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `InventoryLot_batchNumber_idx` ON `InventoryLot`(`batchNumber`);
CREATE INDEX `InventoryLot_storageLocationId_status_idx` ON `InventoryLot`(`storageLocationId`, `status`);
CREATE INDEX `StockMovement_locationId_movementDate_idx` ON `StockMovement`(`locationId`, `movementDate`);
CREATE INDEX `StockMovement_transferReference_idx` ON `StockMovement`(`transferReference`);

ALTER TABLE `InventoryLot`
  ADD CONSTRAINT `InventoryLot_tradeId_fkey` FOREIGN KEY (`tradeId`) REFERENCES `Trade`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `InventoryLot_storageLocationId_fkey` FOREIGN KEY (`storageLocationId`) REFERENCES `StorageLocation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `StorageLocation`
  ADD CONSTRAINT `StorageLocation_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StockMovement`
  ADD CONSTRAINT `StockMovement_tradeId_fkey` FOREIGN KEY (`tradeId`) REFERENCES `Trade`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `StockMovement_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `StorageLocation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `StockMovement_fromLocationId_fkey` FOREIGN KEY (`fromLocationId`) REFERENCES `StorageLocation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `StockMovement_toLocationId_fkey` FOREIGN KEY (`toLocationId`) REFERENCES `StorageLocation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `StorageLocation` (`id`, `name`, `createdAt`, `createdById`)
SELECT 'main-storage-inventory-migration', 'Main storage', CURRENT_TIMESTAMP(3), `User`.`id`
FROM `User`
ORDER BY `User`.`createdAt`, `User`.`id`
LIMIT 1
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

UPDATE `InventoryLot`
LEFT JOIN `Trade` ON `Trade`.`id` = `InventoryLot`.`tradeId`
LEFT JOIN `Customer` ON `Customer`.`id` = `Trade`.`customerId`
SET
  `InventoryLot`.`batchNumber` = COALESCE(NULLIF(`InventoryLot`.`batchNumber`, ''), `Trade`.`reference`, CONCAT('BAT-', `InventoryLot`.`id`)),
  `InventoryLot`.`source` = COALESCE(NULLIF(`InventoryLot`.`source`, ''), `Customer`.`name`, 'Purchase'),
  `InventoryLot`.`receivedAt` = COALESCE(`Trade`.`transactionDate`, `InventoryLot`.`receivedAt`),
  `InventoryLot`.`status` = IF(`InventoryLot`.`remainingGrams` > 0, 'ACTIVE', 'DEPLETED'),
  `InventoryLot`.`storageLocationId` = COALESCE(`InventoryLot`.`storageLocationId`, (SELECT `id` FROM `StorageLocation` WHERE `name` = 'Main storage' LIMIT 1));

UPDATE `Trade`
SET
  `inventoryBatchNumber` = COALESCE(`inventoryBatchNumber`, `reference`),
  `storageLocationName` = COALESCE(`storageLocationName`, 'Main storage')
WHERE `type` = 'PURCHASE';

UPDATE `StockMovement`
LEFT JOIN `InventoryLot` ON `InventoryLot`.`id` = `StockMovement`.`inventoryLotId`
SET
  `StockMovement`.`locationId` = COALESCE(`StockMovement`.`locationId`, `InventoryLot`.`storageLocationId`),
  `StockMovement`.`reason` = COALESCE(`StockMovement`.`reason`, CASE
    WHEN `StockMovement`.`type` = 'PURCHASE_RECEIPT' THEN 'Received purchase stock'
    WHEN `StockMovement`.`type` = 'SALE_ISSUE' THEN 'Sale issue'
    WHEN `StockMovement`.`type` = 'SALE_RETURN' THEN 'Sale return'
    ELSE 'Historical stock movement'
  END);

INSERT INTO `StockMovement`
  (`id`, `reference`, `type`, `tradeId`, `inventoryLotId`, `locationId`, `quantityGrams`, `movementDate`, `createdAt`, `createdById`, `reason`)
SELECT
  UUID(),
  CONCAT('MOV-REC-', REPLACE(UUID(), '-', '')),
  'PURCHASE_RECEIPT',
  `InventoryLot`.`tradeId`,
  `InventoryLot`.`id`,
  `InventoryLot`.`storageLocationId`,
  `InventoryLot`.`originalGrams`,
  COALESCE(`Trade`.`transactionDate`, `InventoryLot`.`receivedAt`),
  CURRENT_TIMESTAMP(3),
  `Trade`.`createdById`,
  'Backfilled original receipt for inventory ledger'
FROM `InventoryLot`
JOIN `Trade` ON `Trade`.`id` = `InventoryLot`.`tradeId`
WHERE NOT EXISTS (
  SELECT 1
  FROM `StockMovement` AS `ExistingMovement`
  WHERE `ExistingMovement`.`inventoryLotId` = `InventoryLot`.`id`
    AND `ExistingMovement`.`type` IN ('PURCHASE_RECEIPT', 'OPENING_BALANCE')
);

INSERT INTO `StockMovement`
  (`id`, `reference`, `type`, `tradeId`, `inventoryLotId`, `locationId`, `quantityGrams`, `movementDate`, `createdAt`, `createdById`, `reason`)
SELECT
  UUID(),
  CONCAT('MOV-REC-', REPLACE(UUID(), '-', '')),
  'SALE_ISSUE',
  `InventoryAllocation`.`tradeId`,
  `InventoryAllocation`.`lotId`,
  `InventoryLot`.`storageLocationId`,
  `InventoryAllocation`.`grams`,
  `Trade`.`transactionDate`,
  CURRENT_TIMESTAMP(3),
  `Trade`.`createdById`,
  'Backfilled sale batch allocation for inventory ledger'
FROM `InventoryAllocation`
JOIN `Trade` ON `Trade`.`id` = `InventoryAllocation`.`tradeId`
JOIN `InventoryLot` ON `InventoryLot`.`id` = `InventoryAllocation`.`lotId`
WHERE NOT EXISTS (
  SELECT 1
  FROM `StockMovement` AS `ExistingMovement`
  WHERE `ExistingMovement`.`tradeId` = `InventoryAllocation`.`tradeId`
    AND `ExistingMovement`.`inventoryLotId` = `InventoryAllocation`.`lotId`
    AND `ExistingMovement`.`type` = 'SALE_ISSUE'
);
