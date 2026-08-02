-- Hot-filter columns polled every 3-5s with no index — sequential scans that
-- grow with accumulated sessions/verifications over a real term.
CREATE INDEX "LabSession_instructorCode_idx" ON "LabSession"("instructorCode");
CREATE INDEX "LabSession_userId_idx" ON "LabSession"("userId");
CREATE INDEX "LabSession_experimentId_idx" ON "LabSession"("experimentId");
CREATE INDEX "VerificationEntry_sessionId_idx" ON "VerificationEntry"("sessionId");
CREATE INDEX "VerificationEntry_status_idx" ON "VerificationEntry"("status");
