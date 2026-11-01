UPDATE `InventoryLot`
SET `batchNumber` = RIGHT(`batchNumber`, 8)
WHERE `batchNumber` REGEXP '^BAT-[0-9]{8}-[A-F0-9]{8}$';

UPDATE `Trade`
SET `inventoryBatchNumber` = RIGHT(`inventoryBatchNumber`, 8)
WHERE `inventoryBatchNumber` REGEXP '^BAT-[0-9]{8}-[A-F0-9]{8}$';
