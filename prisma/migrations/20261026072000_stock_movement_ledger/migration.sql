CREATE TABLE `StockMovement` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `type` ENUM('PURCHASE_RECEIPT', 'SALE_ISSUE') NOT NULL,
    `tradeId` VARCHAR(191) NOT NULL,
    `inventoryLotId` VARCHAR(191) NULL,
    `quantityGrams` DECIMAL(16, 5) NOT NULL,
    `movementDate` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `StockMovement_reference_key`(`reference`),
    INDEX `StockMovement_movementDate_createdAt_idx`(`movementDate`, `createdAt`),
    INDEX `StockMovement_tradeId_idx`(`tradeId`),
    INDEX `StockMovement_inventoryLotId_idx`(`inventoryLotId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `StockMovement`
    ADD CONSTRAINT `StockMovement_tradeId_fkey`
    FOREIGN KEY (`tradeId`) REFERENCES `Trade`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `StockMovement_inventoryLotId_fkey`
    FOREIGN KEY (`inventoryLotId`) REFERENCES `InventoryLot`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `StockMovement_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `StockMovement`
    (`id`, `reference`, `type`, `tradeId`, `inventoryLotId`, `quantityGrams`, `movementDate`, `createdAt`, `createdById`)
SELECT
    CONCAT('mov_', SHA2(CONCAT('purchase:', `Trade`.`id`), 256)),
    CONCAT('MOV-PUR-', SUBSTRING(SHA2(`Trade`.`id`, 256), 1, 24)),
    'PURCHASE_RECEIPT',
    `Trade`.`id`,
    `InventoryLot`.`id`,
    `InventoryLot`.`originalGrams`,
    `Trade`.`transactionDate`,
    `Trade`.`createdAt`,
    `Trade`.`createdById`
FROM `Trade`
INNER JOIN `InventoryLot` ON `InventoryLot`.`tradeId` = `Trade`.`id`
WHERE `Trade`.`type` = 'PURCHASE' AND `Trade`.`status` = 'POSTED';

INSERT INTO `StockMovement`
    (`id`, `reference`, `type`, `tradeId`, `inventoryLotId`, `quantityGrams`, `movementDate`, `createdAt`, `createdById`)
SELECT
    CONCAT('mov_', SHA2(CONCAT('sale:', `Trade`.`id`), 256)),
    CONCAT('MOV-SAL-', SUBSTRING(SHA2(`Trade`.`id`, 256), 1, 24)),
    'SALE_ISSUE',
    `Trade`.`id`,
    NULL,
    SUM(`InventoryAllocation`.`grams`),
    `Trade`.`transactionDate`,
    `Trade`.`createdAt`,
    `Trade`.`createdById`
FROM `Trade`
INNER JOIN `InventoryAllocation` ON `InventoryAllocation`.`tradeId` = `Trade`.`id`
WHERE `Trade`.`type` = 'SALE' AND `Trade`.`status` = 'POSTED'
GROUP BY `Trade`.`id`, `Trade`.`transactionDate`, `Trade`.`createdAt`, `Trade`.`createdById`;
