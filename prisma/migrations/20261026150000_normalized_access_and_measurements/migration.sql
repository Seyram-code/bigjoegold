CREATE TABLE `Role` (
  `code` VARCHAR(40) NOT NULL,
  `label` VARCHAR(80) NOT NULL,
  `isSystem` BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Permission` (
  `code` VARCHAR(80) NOT NULL,
  `description` VARCHAR(180) NOT NULL,
  PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RolePermission` (
  `roleCode` VARCHAR(40) NOT NULL,
  `permissionCode` VARCHAR(80) NOT NULL,
  PRIMARY KEY (`roleCode`, `permissionCode`),
  INDEX `RolePermission_permissionCode_idx` (`permissionCode`),
  CONSTRAINT `RolePermission_roleCode_fkey` FOREIGN KEY (`roleCode`) REFERENCES `Role` (`code`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `RolePermission_permissionCode_fkey` FOREIGN KEY (`permissionCode`) REFERENCES `Permission` (`code`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UserPermission` (
  `userId` VARCHAR(191) NOT NULL,
  `permissionCode` VARCHAR(80) NOT NULL,
  PRIMARY KEY (`userId`, `permissionCode`),
  INDEX `UserPermission_permissionCode_idx` (`permissionCode`),
  CONSTRAINT `UserPermission_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `UserPermission_permissionCode_fkey` FOREIGN KEY (`permissionCode`) REFERENCES `Permission` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `Role` (`code`, `label`) VALUES
  ('OWNER', 'Owner / Super Administrator'),
  ('MANAGER', 'Manager'),
  ('GOLD_RECEIVER', 'Gold Receiver / Buyer'),
  ('SALES_OFFICER', 'Sales Officer'),
  ('INVENTORY_OFFICER', 'Inventory Officer'),
  ('ACCOUNTANT', 'Accountant'),
  ('AUDITOR', 'Read-only Auditor'),
  ('TRADER', 'Trader'),
  ('VIEWER', 'Read-only Viewer');

INSERT INTO `Permission` (`code`, `description`) VALUES
  ('dashboard:read', 'View the dashboard'),
  ('customers:read', 'View customer records'),
  ('customers:personal:read', 'View customer personal details'),
  ('customers:export', 'Export customer records'),
  ('customers:write', 'Create and update customers'),
  ('trades:read', 'View purchases and sales'),
  ('trades:write', 'Legacy combined purchase and sale entry'),
  ('purchases:write', 'Record purchases and receive gold'),
  ('sales:write', 'Record sales'),
  ('transactions:reverse', 'Reverse a posted transaction'),
  ('trades:discount', 'Apply sales discounts'),
  ('inventory:read', 'View stock and batches'),
  ('inventory:adjust', 'Adjust stock'),
  ('inventory:transfer', 'Transfer stock'),
  ('inventory:reconcile', 'Reconcile stock'),
  ('payments:read', 'View payments'),
  ('payments:write', 'Record payments'),
  ('expenses:read', 'View expenses'),
  ('expenses:write', 'Record expenses'),
  ('finance:manage', 'Manage financial accounts and settings'),
  ('finance:approve', 'Approve high-value financial actions'),
  ('reports:read', 'View reports'),
  ('board:read', 'View board prices'),
  ('board:write', 'Change board prices'),
  ('staff:read', 'View staff accounts'),
  ('staff:write', 'Manage staff accounts and permissions'),
  ('audit:read', 'View audit history'),
  ('settings:manage', 'Manage system settings');

INSERT INTO `RolePermission` (`roleCode`, `permissionCode`)
SELECT 'OWNER', `code` FROM `Permission`;

INSERT INTO `RolePermission` (`roleCode`, `permissionCode`) VALUES
  ('MANAGER', 'dashboard:read'), ('MANAGER', 'customers:read'), ('MANAGER', 'customers:personal:read'), ('MANAGER', 'customers:export'), ('MANAGER', 'customers:write'),
  ('MANAGER', 'trades:read'), ('MANAGER', 'trades:write'), ('MANAGER', 'purchases:write'), ('MANAGER', 'sales:write'), ('MANAGER', 'transactions:reverse'), ('MANAGER', 'trades:discount'),
  ('MANAGER', 'inventory:read'), ('MANAGER', 'inventory:adjust'), ('MANAGER', 'inventory:transfer'), ('MANAGER', 'inventory:reconcile'),
  ('MANAGER', 'payments:read'), ('MANAGER', 'payments:write'), ('MANAGER', 'expenses:read'), ('MANAGER', 'expenses:write'), ('MANAGER', 'finance:manage'), ('MANAGER', 'finance:approve'),
  ('MANAGER', 'reports:read'), ('MANAGER', 'board:read'), ('MANAGER', 'board:write'), ('MANAGER', 'staff:read'), ('MANAGER', 'audit:read'),
  ('GOLD_RECEIVER', 'dashboard:read'), ('GOLD_RECEIVER', 'customers:read'), ('GOLD_RECEIVER', 'customers:personal:read'), ('GOLD_RECEIVER', 'customers:write'), ('GOLD_RECEIVER', 'trades:read'), ('GOLD_RECEIVER', 'purchases:write'),
  ('GOLD_RECEIVER', 'inventory:read'), ('GOLD_RECEIVER', 'payments:read'), ('GOLD_RECEIVER', 'payments:write'), ('GOLD_RECEIVER', 'board:read'),
  ('SALES_OFFICER', 'dashboard:read'), ('SALES_OFFICER', 'customers:read'), ('SALES_OFFICER', 'customers:personal:read'), ('SALES_OFFICER', 'customers:write'), ('SALES_OFFICER', 'trades:read'), ('SALES_OFFICER', 'sales:write'),
  ('SALES_OFFICER', 'inventory:read'), ('SALES_OFFICER', 'payments:read'), ('SALES_OFFICER', 'payments:write'), ('SALES_OFFICER', 'board:read'),
  ('INVENTORY_OFFICER', 'dashboard:read'), ('INVENTORY_OFFICER', 'trades:read'), ('INVENTORY_OFFICER', 'inventory:read'), ('INVENTORY_OFFICER', 'inventory:adjust'), ('INVENTORY_OFFICER', 'inventory:transfer'), ('INVENTORY_OFFICER', 'inventory:reconcile'),
  ('ACCOUNTANT', 'dashboard:read'), ('ACCOUNTANT', 'customers:read'), ('ACCOUNTANT', 'customers:personal:read'), ('ACCOUNTANT', 'customers:export'), ('ACCOUNTANT', 'trades:read'), ('ACCOUNTANT', 'payments:read'),
  ('ACCOUNTANT', 'payments:write'), ('ACCOUNTANT', 'expenses:read'), ('ACCOUNTANT', 'expenses:write'), ('ACCOUNTANT', 'finance:manage'), ('ACCOUNTANT', 'finance:approve'), ('ACCOUNTANT', 'reports:read'), ('ACCOUNTANT', 'board:read'), ('ACCOUNTANT', 'audit:read'),
  ('AUDITOR', 'dashboard:read'), ('AUDITOR', 'customers:read'), ('AUDITOR', 'trades:read'), ('AUDITOR', 'inventory:read'), ('AUDITOR', 'payments:read'), ('AUDITOR', 'expenses:read'), ('AUDITOR', 'reports:read'), ('AUDITOR', 'board:read'), ('AUDITOR', 'audit:read'),
  ('TRADER', 'dashboard:read'), ('TRADER', 'customers:read'), ('TRADER', 'customers:personal:read'), ('TRADER', 'customers:write'), ('TRADER', 'trades:read'), ('TRADER', 'trades:write'),
  ('TRADER', 'purchases:write'), ('TRADER', 'sales:write'), ('TRADER', 'inventory:read'), ('TRADER', 'payments:read'), ('TRADER', 'payments:write'), ('TRADER', 'board:read'),
  ('VIEWER', 'dashboard:read'), ('VIEWER', 'customers:read'), ('VIEWER', 'trades:read'), ('VIEWER', 'inventory:read'), ('VIEWER', 'payments:read'), ('VIEWER', 'expenses:read'),
  ('VIEWER', 'reports:read'), ('VIEWER', 'board:read'), ('VIEWER', 'audit:read');

ALTER TABLE `User`
  ADD COLUMN `permissionOverrideSet` BOOLEAN NOT NULL DEFAULT false,
  MODIFY COLUMN `role` VARCHAR(40) NOT NULL DEFAULT 'TRADER';

UPDATE `User`
SET `permissionOverrideSet` = true
WHERE `permissions` IS NOT NULL;

INSERT IGNORE INTO `UserPermission` (`userId`, `permissionCode`)
SELECT `User`.`id`, `grant`.`permissionCode`
FROM `User`
JOIN JSON_TABLE(
  `User`.`permissions`,
  '$[*]' COLUMNS (`permissionCode` VARCHAR(80) PATH '$')
) AS `grant`
JOIN `Permission` ON `Permission`.`code` = CONVERT(`grant`.`permissionCode` USING utf8mb4) COLLATE utf8mb4_unicode_ci
WHERE `User`.`permissions` IS NOT NULL;

ALTER TABLE `User`
  ADD CONSTRAINT `User_role_fkey` FOREIGN KEY (`role`) REFERENCES `Role` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE,
  DROP COLUMN `permissions`;

CREATE TABLE `GoldPurchaseMeasurement` (
  `id` VARCHAR(191) NOT NULL,
  `tradeId` VARCHAR(191) NOT NULL,
  `topKg` DECIMAL(14,8) NOT NULL,
  `downKg` DECIMAL(14,8) NOT NULL,
  `pounds` DECIMAL(16,8) NOT NULL,
  `density` DECIMAL(24,8) NOT NULL,
  `karat` DECIMAL(16,8) NOT NULL,
  `formulaVersion` VARCHAR(191) NOT NULL,
  `formulaInputs` JSON NOT NULL,
  `calculationSource` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `GoldPurchaseMeasurement_tradeId_key` (`tradeId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `GoldPurchaseMeasurement_tradeId_fkey` FOREIGN KEY (`tradeId`) REFERENCES `Trade` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `GoldPurchaseMeasurement` (
  `id`, `tradeId`, `topKg`, `downKg`, `pounds`, `density`, `karat`,
  `formulaVersion`, `formulaInputs`, `calculationSource`, `createdAt`, `updatedAt`
)
SELECT
  CONCAT('legacy_', `Trade`.`id`), `Trade`.`id`, `Trade`.`topKg`, `Trade`.`downKg`, `Trade`.`pounds`, `Trade`.`density`, `Trade`.`karat`,
  COALESCE(`Trade`.`formulaVersion`, 'legacy'), COALESCE(`Trade`.`formulaInputs`, JSON_OBJECT()),
  COALESCE(`Trade`.`calculationSource`, 'LEGACY'), `Trade`.`createdAt`, `Trade`.`createdAt`
FROM `Trade`
WHERE `Trade`.`type` = 'PURCHASE' AND `Trade`.`topKg` IS NOT NULL;

ALTER TABLE `Trade`
  DROP COLUMN `topKg`,
  DROP COLUMN `downKg`,
  DROP COLUMN `pounds`,
  DROP COLUMN `density`,
  DROP COLUMN `karat`,
  DROP COLUMN `formulaVersion`,
  DROP COLUMN `formulaInputs`,
  DROP COLUMN `calculationSource`;
