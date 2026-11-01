UPDATE `Trade`
SET `transactionDate` = `createdAt`
WHERE `topKg` IS NULL;

UPDATE `StockMovement` AS movement
INNER JOIN `Trade` AS trade ON trade.`id` = movement.`tradeId`
SET movement.`movementDate` = trade.`transactionDate`
WHERE trade.`topKg` IS NULL;
