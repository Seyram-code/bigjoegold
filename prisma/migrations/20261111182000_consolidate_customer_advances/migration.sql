ALTER TABLE `CustomerAdvance`
  ADD COLUMN `mergedIntoId` VARCHAR(191) NULL,
  ADD INDEX `CustomerAdvance_mergedIntoId_idx` (`mergedIntoId`),
  ADD CONSTRAINT `CustomerAdvance_mergedIntoId_fkey`
    FOREIGN KEY (`mergedIntoId`) REFERENCES `CustomerAdvance` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TEMPORARY TABLE `CustomerAdvanceMergeGroups` AS
SELECT
  grouped.`customerId`,
  (
    SELECT `candidate`.`id`
    FROM `CustomerAdvance` AS `candidate`
    WHERE `candidate`.`customerId` = grouped.`customerId`
    ORDER BY `candidate`.`createdAt` ASC, `candidate`.`id` ASC
    LIMIT 1
  ) AS `canonicalId`,
  grouped.`openingBalance`,
  (
    SELECT `candidate`.`openingBalance`
    FROM `CustomerAdvance` AS `candidate`
    WHERE `candidate`.`customerId` = grouped.`customerId`
    ORDER BY `candidate`.`createdAt` ASC, `candidate`.`id` ASC
    LIMIT 1
  ) AS `canonicalOpeningBalance`
FROM (
  SELECT `customerId`, SUM(`openingBalance`) AS `openingBalance`
  FROM `CustomerAdvance`
  WHERE `mergedIntoId` IS NULL
  GROUP BY `customerId`
  HAVING COUNT(*) > 1
) AS grouped;

CREATE TEMPORARY TABLE `CustomerAdvanceMergeMap` AS
SELECT `source`.`id` AS `sourceId`, `groups`.`canonicalId`
FROM `CustomerAdvanceMergeGroups` AS `groups`
JOIN `CustomerAdvance` AS `source` ON `source`.`customerId` = `groups`.`customerId`
WHERE `source`.`id` <> `groups`.`canonicalId`
  AND `source`.`mergedIntoId` IS NULL;

INSERT INTO `AuditLog` (`id`, `action`, `entity`, `entityId`, `details`, `createdAt`)
SELECT
  CONCAT('migration-', UUID()),
  'customer.advance.accounts.merged',
  'CustomerAdvance',
  `groups`.`canonicalId`,
  JSON_OBJECT(
    'canonicalReference', `canonical`.`reference`,
    'canonicalOpeningBalanceBefore', `groups`.`canonicalOpeningBalance`,
    'openingBalanceAfter', `groups`.`openingBalance`,
    'mergedAccounts', (
      SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'reference', `source`.`reference`,
        'openingBalance', `source`.`openingBalance`
      ))
      FROM `CustomerAdvanceMergeMap` AS `map`
      JOIN `CustomerAdvance` AS `source` ON `source`.`id` = `map`.`sourceId`
      WHERE `map`.`canonicalId` = `groups`.`canonicalId`
    )
  ),
  CURRENT_TIMESTAMP(3)
FROM `CustomerAdvanceMergeGroups` AS `groups`
JOIN `CustomerAdvance` AS `canonical` ON `canonical`.`id` = `groups`.`canonicalId`;

UPDATE `Payment` AS `payment`
JOIN `CustomerAdvanceMergeMap` AS `map` ON `map`.`sourceId` = `payment`.`customerAdvanceId`
SET `payment`.`customerAdvanceId` = `map`.`canonicalId`;

UPDATE `CustomerAdvanceRequest` AS `request`
JOIN `CustomerAdvanceMergeMap` AS `map` ON `map`.`sourceId` = `request`.`advanceId`
SET `request`.`advanceId` = `map`.`canonicalId`;

UPDATE `CustomerAdvance` AS `canonical`
JOIN `CustomerAdvanceMergeGroups` AS `groups` ON `groups`.`canonicalId` = `canonical`.`id`
SET `canonical`.`openingBalance` = `groups`.`openingBalance`;

UPDATE `CustomerAdvance` AS `source`
JOIN `CustomerAdvanceMergeMap` AS `map` ON `map`.`sourceId` = `source`.`id`
SET `source`.`openingBalance` = 0,
    `source`.`mergedIntoId` = `map`.`canonicalId`;

DROP TEMPORARY TABLE `CustomerAdvanceMergeMap`;
DROP TEMPORARY TABLE `CustomerAdvanceMergeGroups`;
