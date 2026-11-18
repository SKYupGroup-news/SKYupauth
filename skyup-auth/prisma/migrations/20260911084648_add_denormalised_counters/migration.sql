-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "replyCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "article_stats" (
    "articleId" TEXT NOT NULL,
    "articleTitle" TEXT,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_stats_pkey" PRIMARY KEY ("articleId")
);

-- CreateIndex
CREATE INDEX "article_stats_likeCount_idx" ON "article_stats"("likeCount");
