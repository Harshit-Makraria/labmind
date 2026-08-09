-- Photos move from inline base64 to object storage.
-- Purely additive and nullable: existing rows keep their imageBase64 and are
-- read exactly as before, so no backfill and no downtime.
ALTER TABLE "VerificationEntry" ADD COLUMN "imageKey" TEXT;
