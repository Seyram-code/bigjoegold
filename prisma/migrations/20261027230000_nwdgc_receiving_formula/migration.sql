ALTER TABLE `PurchaseFormulaConfig`
  CHANGE COLUMN `amountKaratAdjustment` `karatDiscountMultiplier` DECIMAL(16, 8) NOT NULL;

UPDATE `PurchaseFormulaConfig`
SET
  `version` = 'BJG-RECEIVING-2.0.0',
  `ownerConfirmed` = false,
  `poundsKgDivisor` = 7.75,
  `densityReference` = 10.51,
  `karatMultiplier` = 52.838,
  `karatDiscountMultiplier` = 0.993,
  `amountKaratDivisor` = 23
WHERE `id` = 'default';
