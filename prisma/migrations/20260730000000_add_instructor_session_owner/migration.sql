-- AlterTable
ALTER TABLE "InstructorSession" ADD COLUMN "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "InstructorSession_createdByUserId_idx" ON "InstructorSession"("createdByUserId");
