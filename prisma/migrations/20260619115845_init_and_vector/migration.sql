-- Create pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "RecordVectorChunk" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "embedding" vector(768),

    CONSTRAINT "RecordVectorChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordVectorChunk_recordId_idx" ON "RecordVectorChunk"("recordId");

-- CreateIndex
CREATE INDEX "RecordVectorChunk_patientId_idx" ON "RecordVectorChunk"("patientId");

-- AddForeignKey
ALTER TABLE "RecordVectorChunk" ADD CONSTRAINT "RecordVectorChunk_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MedicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
