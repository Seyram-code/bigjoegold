CREATE TABLE `RateLimit` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `count` INTEGER NOT NULL,
  `lastRequest` BIGINT NOT NULL,
  UNIQUE INDEX `RateLimit_key_key` (`key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ApiRequestRateLimit` (
  `key` VARCHAR(191) NOT NULL,
  `count` INTEGER NOT NULL,
  `windowStartedAt` DATETIME(3) NOT NULL,
  INDEX `ApiRequestRateLimit_windowStartedAt_idx` (`windowStartedAt`),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
