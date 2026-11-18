-- DropIndex
DROP INDEX "comments_article_title_trgm_idx";

-- DropIndex
DROP INDEX "comments_body_trgm_idx";

-- DropIndex
DROP INDEX "users_display_name_trgm_idx";

-- DropIndex
DROP INDEX "users_email_trgm_idx";

-- AlterTable
ALTER TABLE "article_stats" ADD COLUMN     "articleLocation" TEXT;

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "articleLocation" TEXT;
