-- CreateTable
CREATE TABLE "LabSession" (
    "id" TEXT NOT NULL,
    "studentName" TEXT NOT NULL DEFAULT 'Student',
    "experimentId" TEXT NOT NULL,
    "experimentName" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "totalSteps" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reagentHistory" JSONB NOT NULL DEFAULT '[]',
    "lastVisionPass" BOOLEAN,
    "deviationPercent" DOUBLE PRECISION,
    "safetyAlertCount" INTEGER NOT NULL DEFAULT 0,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "safetyLog" JSONB NOT NULL DEFAULT '[]',
    "notes" JSONB NOT NULL DEFAULT '[]',
    "instructorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorSession" (
    "code" TEXT NOT NULL,
    "sessionName" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "experimentName" TEXT NOT NULL,
    "batch" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstructorSession_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "VerificationEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "imageBase64" TEXT NOT NULL,
    "aiReading" DOUBLE PRECISION,
    "aiConfidence" DOUBLE PRECISION NOT NULL,
    "aiMessage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "instructorComment" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "VerificationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "outcome" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceSpan" (
    "id" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "inputSummary" TEXT NOT NULL,
    "outputSummary" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceSpan_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LabSession" ADD CONSTRAINT "LabSession_instructorCode_fkey" FOREIGN KEY ("instructorCode") REFERENCES "InstructorSession"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEntry" ADD CONSTRAINT "VerificationEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LabSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
