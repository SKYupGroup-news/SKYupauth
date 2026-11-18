-- Deleting a reader must not delete replies written by other people. With
-- CASCADE, erasing one account silently destroyed everyone who had answered it.
ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_parentId_fkey";

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "comments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
