CREATE TABLE `IdempotencyRecord` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `route` VARCHAR(120) NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `state` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `statusCode` INTEGER NULL,
    `response` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `IdempotencyRecord_userId_route_key_key`(`userId`, `route`, `key`),
    INDEX `IdempotencyRecord_createdAt_idx`(`createdAt`),
    CONSTRAINT `IdempotencyRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
