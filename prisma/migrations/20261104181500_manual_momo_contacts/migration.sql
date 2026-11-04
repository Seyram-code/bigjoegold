CREATE TABLE `ManualMomoContact` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `phone` VARCHAR(40) NULL,
  `phoneNormalized` VARCHAR(20) NULL,
  `email` VARCHAR(254) NULL,
  `notes` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `ManualMomoContact_phoneNormalized_key` (`phoneNormalized`),
  INDEX `ManualMomoContact_name_idx` (`name`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ManualMomoContact_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
