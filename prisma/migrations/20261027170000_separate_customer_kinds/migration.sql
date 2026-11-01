ALTER TABLE `Customer`
  ADD COLUMN `kind` ENUM('SUPPLIER', 'BUYER') NOT NULL DEFAULT 'BUYER',
  ADD INDEX `Customer_kind_isActive_createdAt_idx` (`kind`, `isActive`, `createdAt`);

CREATE TEMPORARY TABLE `_CustomerBuyerSplit` (
  `supplierId` VARCHAR(191) NOT NULL PRIMARY KEY,
  `buyerId` VARCHAR(191) NOT NULL UNIQUE
);

INSERT INTO `_CustomerBuyerSplit` (`supplierId`, `buyerId`)
SELECT c.`id`, UUID()
FROM `Customer` c
WHERE EXISTS (
  SELECT 1 FROM `Trade` t WHERE t.`customerId` = c.`id` AND t.`type` = 'PURCHASE'
)
AND (
  EXISTS (SELECT 1 FROM `Trade` t WHERE t.`customerId` = c.`id` AND t.`type` = 'SALE')
  OR EXISTS (SELECT 1 FROM `CustomerAdvance` a WHERE a.`customerId` = c.`id`)
);

INSERT INTO `Customer` (
  `id`, `code`, `name`, `type`, `kind`, `phone`, `alternativePhone`, `email`,
  `dateOfBirth`, `gender`, `idType`, `idNumber`, `tin`, `address`, `addressLine1`,
  `addressLine2`, `city`, `region`, `country`, `gpsLocation`, `notes`, `isActive`,
  `createdAt`, `updatedAt`
)
SELECT
  split.`buyerId`, CONCAT('CUS-BUY-', REPLACE(UUID(), '-', '')), c.`name`, c.`type`, 'BUYER',
  c.`phone`, c.`alternativePhone`, c.`email`, c.`dateOfBirth`, c.`gender`, c.`idType`,
  c.`idNumber`, c.`tin`, c.`address`, c.`addressLine1`, c.`addressLine2`, c.`city`,
  c.`region`, c.`country`, c.`gpsLocation`, c.`notes`, c.`isActive`, c.`createdAt`, NOW(3)
FROM `Customer` c
JOIN `_CustomerBuyerSplit` split ON split.`supplierId` = c.`id`;

UPDATE `Trade` t
JOIN `_CustomerBuyerSplit` split ON split.`supplierId` = t.`customerId`
SET t.`customerId` = split.`buyerId`
WHERE t.`type` = 'SALE';

UPDATE `CustomerAdvance` a
JOIN `_CustomerBuyerSplit` split ON split.`supplierId` = a.`customerId`
SET a.`customerId` = split.`buyerId`;

UPDATE `Payment` p
JOIN `_CustomerBuyerSplit` split ON split.`supplierId` = p.`customerId`
LEFT JOIN `Trade` t ON t.`id` = p.`tradeId`
LEFT JOIN `CustomerAdvance` a ON a.`id` = p.`customerAdvanceId`
SET p.`customerId` = split.`buyerId`
WHERE t.`type` = 'SALE' OR a.`id` IS NOT NULL;

UPDATE `Customer` c
SET c.`kind` = CASE
  WHEN EXISTS (SELECT 1 FROM `Trade` t WHERE t.`customerId` = c.`id` AND t.`type` = 'PURCHASE')
    THEN 'SUPPLIER'
  ELSE 'BUYER'
END;

DROP TEMPORARY TABLE `_CustomerBuyerSplit`;
