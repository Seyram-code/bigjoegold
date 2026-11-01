CREATE TABLE `FinanceCategory` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `FinanceCategory_name_key`(`name`),
  INDEX `FinanceCategory_isActive_name_idx`(`isActive`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `FinanceCategory` (`id`, `name`) VALUES
  ('finance-category-transport', 'TRANSPORT'),
  ('finance-category-security', 'SECURITY'),
  ('finance-category-utilities', 'UTILITIES'),
  ('finance-category-rent', 'RENT'),
  ('finance-category-staff', 'STAFF'),
  ('finance-category-assay', 'ASSAY'),
  ('finance-category-supplies', 'SUPPLIES'),
  ('finance-category-other', 'OTHER');

CREATE TABLE `CashAccount` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `type` ENUM('CASH', 'BANK', 'MOBILE_MONEY') NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'GHS',
  `institution` VARCHAR(120) NULL,
  `accountReference` VARCHAR(120) NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `CashAccount_name_key`(`name`),
  INDEX `CashAccount_isActive_type_idx`(`isActive`, `type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CashMovement` (
  `id` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `accountId` VARCHAR(191) NOT NULL,
  `type` ENUM('OPENING_BALANCE', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT') NOT NULL,
  `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
  `amount` DECIMAL(16, 2) NOT NULL,
  `movementDate` DATETIME(3) NOT NULL,
  `description` TEXT NULL,
  `paymentId` VARCHAR(191) NULL,
  `transferGroupId` VARCHAR(191) NULL,
  `approvalStatus` ENUM('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NOT_REQUIRED',
  `approvedAt` DATETIME(3) NULL,
  `approvedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `CashMovement_reference_key`(`reference`),
  UNIQUE INDEX `CashMovement_paymentId_key`(`paymentId`),
  INDEX `CashMovement_accountId_movementDate_idx`(`accountId`, `movementDate`),
  INDEX `CashMovement_approvalStatus_movementDate_idx`(`approvalStatus`, `movementDate`),
  INDEX `CashMovement_transferGroupId_idx`(`transferGroupId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FinanceConfig` (
  `id` VARCHAR(191) NOT NULL DEFAULT 'default',
  `expenseApprovalThreshold` DECIMAL(16, 2) NULL,
  `adjustmentApprovalThreshold` DECIMAL(16, 2) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ExpenseAttachment` (
  `id` VARCHAR(191) NOT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `mediaType` VARCHAR(80) NOT NULL,
  `sizeBytes` INTEGER NOT NULL,
  `content` LONGBLOB NOT NULL,
  `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `uploadedById` VARCHAR(191) NOT NULL,
  INDEX `ExpenseAttachment_uploadedAt_idx`(`uploadedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Payment`
  ADD COLUMN `cashAccountId` VARCHAR(191) NULL,
  ADD INDEX `Payment_cashAccountId_paidAt_idx`(`cashAccountId`);

ALTER TABLE `Expense`
  MODIFY `category` VARCHAR(120) NOT NULL,
  MODIFY `receiptRef` TEXT NULL,
  ADD COLUMN `categoryId` VARCHAR(191) NULL,
  ADD COLUMN `attachmentId` VARCHAR(191) NULL,
  ADD COLUMN `approvalStatus` ENUM('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `approvedById` VARCHAR(191) NULL,
  ADD INDEX `Expense_approvalStatus_expenseDate_idx`(`approvalStatus`, `expenseDate`),
  ADD INDEX `Expense_categoryId_expenseDate_idx`(`categoryId`, `expenseDate`),
  ADD UNIQUE INDEX `Expense_attachmentId_key`(`attachmentId`);

UPDATE `Expense`
JOIN `FinanceCategory` ON `FinanceCategory`.`name` = `Expense`.`category`
SET `Expense`.`categoryId` = `FinanceCategory`.`id`;

ALTER TABLE `Payment`
  ADD CONSTRAINT `Payment_cashAccountId_fkey` FOREIGN KEY (`cashAccountId`) REFERENCES `CashAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Expense`
  ADD CONSTRAINT `Expense_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `FinanceCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Expense_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Expense_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `ExpenseAttachment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ExpenseAttachment`
  ADD CONSTRAINT `ExpenseAttachment_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CashAccount`
  ADD CONSTRAINT `CashAccount_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CashMovement`
  ADD CONSTRAINT `CashMovement_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `CashAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CashMovement_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `CashMovement_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `CashMovement_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
