CREATE TABLE `MansoBranch` (
  `id` VARCHAR(191) NOT NULL DEFAULT 'manso',
  `cashAccountId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `MansoBranch_cashAccountId_key` (`cashAccountId`),
  CONSTRAINT `MansoBranch_cashAccountId_fkey` FOREIGN KEY (`cashAccountId`) REFERENCES `CashAccount` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
