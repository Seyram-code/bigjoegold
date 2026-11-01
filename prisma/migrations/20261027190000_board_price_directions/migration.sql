ALTER TABLE `GoldBoardPrice`
  ADD COLUMN `priceType` ENUM('RECEIVING', 'SELLING') NOT NULL DEFAULT 'RECEIVING',
  ADD INDEX `GoldBoardPrice_priceType_effectiveAt_idx` (`priceType`, `effectiveAt`);
