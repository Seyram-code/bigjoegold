UPDATE `CashMovement` movement
JOIN `AuditLog` audit
  ON audit.`entity` = 'CashMovement'
  AND audit.`entityId` = movement.`id`
  AND audit.`action` IN (
    'manso_branch.expense.recorded',
    'manso_branch.expense.submitted_for_approval'
  )
SET movement.`type` = 'EXPENSE',
    movement.`expenseCategory` = 'OTHER'
WHERE movement.`type` = 'ADJUSTMENT_OUT';
