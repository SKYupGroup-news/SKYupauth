-- CreateEnum
CREATE TYPE "AccountActionType" AS ENUM ('SUSPEND', 'REINSTATE');

-- CreateTable
CREATE TABLE "account_actions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" "AccountActionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_actions_userId_createdAt_idx" ON "account_actions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "account_actions_actorId_idx" ON "account_actions"("actorId");

-- AddForeignKey
ALTER TABLE "account_actions" ADD CONSTRAINT "account_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_actions" ADD CONSTRAINT "account_actions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
