-- A deleted reader's payment record must survive them with the identifying
-- link severed: financial law requires keeping the record, data-protection law
-- requires not keeping the person. That needs a nullable owner and SET NULL
-- rather than CASCADE.
ALTER TABLE "invoices" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_userId_fkey";

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
