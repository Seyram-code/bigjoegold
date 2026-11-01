CREATE TABLE `ManualMomoAccount` (
  `name` ENUM('MOMO_1', 'MOMO_2') NOT NULL,
  `openingBalance` DECIMAL(16, 2) NOT NULL DEFAULT 0,
  `openingDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `ManualMomoAccount` (`name`, `openingBalance`, `openingDate`, `updatedAt`) VALUES
  ('MOMO_1', 0, '1970-01-01 00:00:00.000', CURRENT_TIMESTAMP(3)),
  ('MOMO_2', 0, '1970-01-01 00:00:00.000', CURRENT_TIMESTAMP(3));

CREATE TABLE `ManualMomoEntry` (
  `id` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `accountName` ENUM('MOMO_1', 'MOMO_2') NOT NULL,
  `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
  `amount` DECIMAL(16, 2) NOT NULL,
  `customerName` VARCHAR(120) NOT NULL,
  `customerPhone` VARCHAR(40) NULL,
  `transactionReference` VARCHAR(191) NULL,
  `transactionDate` DATETIME(3) NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `ManualMomoEntry_reference_key`(`reference`),
  INDEX `ManualMomoEntry_accountName_transactionDate_idx`(`accountName`, `transactionDate`),
  INDEX `ManualMomoEntry_customerName_transactionDate_idx`(`customerName`, `transactionDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ManualMomoEntry`
  ADD CONSTRAINT `ManualMomoEntry_accountName_fkey`
    FOREIGN KEY (`accountName`) REFERENCES `ManualMomoAccount`(`name`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `ManualMomoEntry_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
