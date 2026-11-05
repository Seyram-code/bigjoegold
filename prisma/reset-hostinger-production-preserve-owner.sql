-- phpMyAdmin import script: clear production data and retain the owner login.
--
-- Before importing:
-- 1. Take a fresh backup of the production database.
-- 2. Select u905864148_bigjoe_db in phpMyAdmin.
-- 3. Confirm the owner email below is correct.
--
-- This preserves the owner User row, credential-provider password, owner
-- permissions, roles, permissions, app configuration, and migration history.
-- Other staff accounts, business data, sessions, and verification tokens are
-- deleted. The owner will need to sign in again after sessions are cleared.
-- No tables are dropped or recreated.

SET @reset_owner_id := (
  SELECT `id`
  FROM `User`
  WHERE `email` = 'admin@bigjoegold.local'
    AND `role` = 'OWNER'
  LIMIT 1
);

SET @reset_unexpected_tables := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE `table_schema` = DATABASE()
    AND `table_type` = 'BASE TABLE'
    AND `table_name` NOT IN (
      '_prisma_migrations',
      'Account',
      'AdvanceFulfillment',
      'ApiRequestRateLimit',
      'AuditLog',
      'BuyerFinanceAccount',
      'BuyerFinanceSettlement',
      'CashAccount',
      'CashMovement',
      'Customer',
      'CustomerAdvance',
      'CustomerAdvanceRequest',
      'FinanceConfig',
      'GoldBoardPrice',
      'GoldPurchaseMeasurement',
      'GoldSaleMeasurement',
      'InventoryAllocation',
      'InventoryLot',
      'ManualMomoAccount',
      'ManualMomoEntry',
      'Payment',
      'Permission',
      'PurchaseFormulaConfig',
      'RateLimit',
      'Role',
      'RolePermission',
      'SaleCorrection',
      'SaleCorrectionAllocation',
      'Session',
      'StockMovement',
      'StorageLocation',
      'Trade',
      'User',
      'UserPermission',
      'Verification'
    )
);

SET @reset_owner_ready := (
  DATABASE() = 'u905864148_bigjoe_db'
  AND @reset_unexpected_tables = 0
  AND @reset_owner_id IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM `User`
    WHERE `email` = 'admin@bigjoegold.local'
      AND `role` = 'OWNER'
  ) = 1
  AND EXISTS (
    SELECT 1
    FROM `Account`
    WHERE `userId` = @reset_owner_id
      AND `providerId` = 'credential'
      AND `password` IS NOT NULL
  )
);

-- Review this result before proceeding. reset_guard must be 1.
SELECT
  DATABASE() AS selected_database,
  @reset_owner_id AS owner_id,
  'admin@bigjoegold.local' AS preserved_owner_email,
  @reset_unexpected_tables AS unexpected_table_count,
  @reset_owner_ready AS reset_guard;

START TRANSACTION;
SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM `AdvanceFulfillment` WHERE @reset_owner_ready = 1;
DELETE FROM `BuyerFinanceSettlement` WHERE @reset_owner_ready = 1;
DELETE FROM `SaleCorrectionAllocation` WHERE @reset_owner_ready = 1;
DELETE FROM `InventoryAllocation` WHERE @reset_owner_ready = 1;
DELETE FROM `StockMovement` WHERE @reset_owner_ready = 1;
DELETE FROM `CashMovement` WHERE @reset_owner_ready = 1;
DELETE FROM `ManualMomoEntry` WHERE @reset_owner_ready = 1;
DELETE FROM `Payment` WHERE @reset_owner_ready = 1;
DELETE FROM `GoldPurchaseMeasurement` WHERE @reset_owner_ready = 1;
DELETE FROM `GoldSaleMeasurement` WHERE @reset_owner_ready = 1;
DELETE FROM `SaleCorrection` WHERE @reset_owner_ready = 1;
DELETE FROM `InventoryLot` WHERE @reset_owner_ready = 1;
DELETE FROM `BuyerFinanceAccount` WHERE @reset_owner_ready = 1;
DELETE FROM `CustomerAdvanceRequest` WHERE @reset_owner_ready = 1;
DELETE FROM `CustomerAdvance` WHERE @reset_owner_ready = 1;
DELETE FROM `CashAccount` WHERE @reset_owner_ready = 1;
DELETE FROM `ManualMomoAccount` WHERE @reset_owner_ready = 1;
DELETE FROM `Trade` WHERE @reset_owner_ready = 1;
DELETE FROM `GoldBoardPrice` WHERE @reset_owner_ready = 1;
DELETE FROM `StorageLocation` WHERE @reset_owner_ready = 1;
DELETE FROM `Customer` WHERE @reset_owner_ready = 1;
DELETE FROM `AuditLog` WHERE @reset_owner_ready = 1;
DELETE FROM `Verification` WHERE @reset_owner_ready = 1;
DELETE FROM `Session` WHERE @reset_owner_ready = 1;
DELETE FROM `RateLimit` WHERE @reset_owner_ready = 1;
DELETE FROM `ApiRequestRateLimit` WHERE @reset_owner_ready = 1;
DELETE FROM `UserPermission`
WHERE @reset_owner_ready = 1
  AND `userId` <> @reset_owner_id;
DELETE FROM `Account`
WHERE @reset_owner_ready = 1
  AND `userId` <> @reset_owner_id;
DELETE FROM `User`
WHERE @reset_owner_ready = 1
  AND `id` <> @reset_owner_id;

SET FOREIGN_KEY_CHECKS = 1;
COMMIT;

-- Verify the owner and credential remain. Expect one owner account.
SELECT `id`, `email`, `role`
FROM `User`
WHERE `id` = @reset_owner_id;

SELECT COUNT(*) AS remaining_owner_credentials
FROM `Account`
WHERE `userId` = @reset_owner_id
  AND `providerId` = 'credential'
  AND `password` IS NOT NULL;

SELECT COUNT(*) AS remaining_users
FROM `User`;
