CREATE TABLE `ManualMomoAccount_new` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `openingBalance` DECIMAL(16, 2) NOT NULL DEFAULT 0,
  `openingDate` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `ManualMomoAccount_new_name_key`(`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TEMPORARY TABLE `ManualMomoAccount_migration_map` (
  `oldName` VARCHAR(120) NOT NULL,
  `newId` VARCHAR(191) NOT NULL,
  `newName` VARCHAR(120) NOT NULL,
  PRIMARY KEY (`oldName`)
);

INSERT INTO `ManualMomoAccount_migration_map` (`oldName`, `newId`, `newName`)
SELECT
  `name`,
  CONCAT('manual-momo-import-', LOWER(`name`)),
  CONCAT('Imported ', REPLACE(`name`, '_', ' '))
FROM `ManualMomoAccount`
WHERE `openingBalance` <> 0
  OR EXISTS (
    SELECT 1 FROM `ManualMomoEntry`
    WHERE `ManualMomoEntry`.`accountName` = `ManualMomoAccount`.`name`
  );

INSERT INTO `ManualMomoAccount_new` (`id`, `name`, `openingBalance`, `openingDate`, `createdAt`, `updatedAt`, `createdById`)
SELECT
  `migration_map`.`newId`,
  `migration_map`.`newName`,
  `old_account`.`openingBalance`,
  `old_account`.`openingDate`,
  `old_account`.`updatedAt`,
  CURRENT_TIMESTAMP(3),
  COALESCE(
    (
      SELECT `ManualMomoEntry`.`createdById`
      FROM `ManualMomoEntry`
      WHERE `ManualMomoEntry`.`accountName` = `old_account`.`name`
      ORDER BY `ManualMomoEntry`.`createdAt` ASC
      LIMIT 1
    ),
    (SELECT `User`.`id` FROM `User` ORDER BY `User`.`createdAt` ASC LIMIT 1)
  )
FROM `ManualMomoAccount` AS `old_account`
JOIN `ManualMomoAccount_migration_map` AS `migration_map`
  ON `migration_map`.`oldName` = `old_account`.`name`;

ALTER TABLE `ManualMomoEntry`
  DROP FOREIGN KEY `ManualMomoEntry_accountName_fkey`,
  DROP INDEX `ManualMomoEntry_accountName_transactionDate_idx`,
  ADD COLUMN `accountId` VARCHAR(191) NULL;

UPDATE `ManualMomoEntry`
JOIN `ManualMomoAccount_migration_map`
  ON `ManualMomoAccount_migration_map`.`oldName` = `ManualMomoEntry`.`accountName`
SET `ManualMomoEntry`.`accountId` = `ManualMomoAccount_migration_map`.`newId`;

ALTER TABLE `ManualMomoEntry`
  DROP COLUMN `accountName`,
  MODIFY COLUMN `accountId` VARCHAR(191) NOT NULL,
  ADD INDEX `ManualMomoEntry_accountId_transactionDate_idx`(`accountId`, `transactionDate`);

DROP TABLE `ManualMomoAccount`;
RENAME TABLE `ManualMomoAccount_new` TO `ManualMomoAccount`;

ALTER TABLE `ManualMomoEntry`
  ADD CONSTRAINT `ManualMomoEntry_accountId_fkey`
    FOREIGN KEY (`accountId`) REFERENCES `ManualMomoAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ManualMomoAccount`
  RENAME INDEX `ManualMomoAccount_new_name_key` TO `ManualMomoAccount_name_key`,
  ADD CONSTRAINT `ManualMomoAccount_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TEMPORARY TABLE `ManualMomoAccount_migration_map`;
