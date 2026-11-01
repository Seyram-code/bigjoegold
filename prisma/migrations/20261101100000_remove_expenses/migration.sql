DELETE FROM `CashMovement`
WHERE `paymentId` IN (SELECT `id` FROM `Payment` WHERE `expenseId` IS NOT NULL);

DELETE FROM `Payment`
WHERE `expenseId` IS NOT NULL;

DELETE FROM `AuditLog`
WHERE `entity` IN ('Expense', 'ExpenseAttachment', 'FinanceCategory')
   OR LOWER(`action`) LIKE '%expense%';

DELETE FROM `UserPermission`
WHERE `permissionCode` IN ('expenses:read', 'expenses:write');

DELETE FROM `RolePermission`
WHERE `permissionCode` IN ('expenses:read', 'expenses:write');

DELETE FROM `Permission`
WHERE `code` IN ('expenses:read', 'expenses:write');

ALTER TABLE `Payment`
  DROP FOREIGN KEY `Payment_expenseId_fkey`,
  DROP INDEX `Payment_expenseId_idx`,
  DROP COLUMN `expenseId`;

ALTER TABLE `Expense`
  DROP FOREIGN KEY `Expense_createdById_fkey`,
  DROP FOREIGN KEY `Expense_categoryId_fkey`,
  DROP FOREIGN KEY `Expense_approvedById_fkey`,
  DROP FOREIGN KEY `Expense_attachmentId_fkey`;

ALTER TABLE `ExpenseAttachment`
  DROP FOREIGN KEY `ExpenseAttachment_uploadedById_fkey`;

DROP TABLE `Expense`;
DROP TABLE `ExpenseAttachment`;
DROP TABLE `FinanceCategory`;

ALTER TABLE `FinanceConfig`
  DROP COLUMN `expenseApprovalThreshold`;
