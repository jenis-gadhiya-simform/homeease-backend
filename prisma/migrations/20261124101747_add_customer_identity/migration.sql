-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateTable
CREATE TABLE "customer_identity" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "customer_identity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_identity_provider_subject_key" ON "customer_identity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "customer_identity_account_id_provider_key" ON "customer_identity"("account_id", "provider");

-- AddForeignKey
ALTER TABLE "customer_identity" ADD CONSTRAINT "customer_identity_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
