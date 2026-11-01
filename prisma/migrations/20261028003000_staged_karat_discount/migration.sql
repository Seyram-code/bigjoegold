UPDATE `PurchaseFormulaConfig`
SET
  `version` = 'BJG-RECEIVING-3.0.0',
  `ownerConfirmed` = false
WHERE `id` = 'default';
