ALTER TABLE `User`
  ADD COLUMN `phone` VARCHAR(191) NULL,
  ADD COLUMN `accessCodeHash` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `User_accessCodeHash_key` (`accessCodeHash`);
