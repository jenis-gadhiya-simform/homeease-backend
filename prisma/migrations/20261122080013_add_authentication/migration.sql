-- CreateEnum
CREATE TYPE "account_token_purpose" AS ENUM ('SETUP', 'RESET');

-- CreateEnum
CREATE TYPE "magic_link_purpose" AS ENUM ('LOGIN', 'RESET');

-- CreateTable
CREATE TABLE "account_setup_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "account_token_purpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_setup_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_account" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_link_token" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "purpose" "magic_link_purpose" NOT NULL DEFAULT 'LOGIN',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_link_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token_family" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "claims" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_setup_token_token_hash_key" ON "account_setup_token"("token_hash");

-- CreateIndex
CREATE INDEX "account_setup_token_user_id_purpose_idx" ON "account_setup_token"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "customer_account_email_key" ON "customer_account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "magic_link_token_token_hash_key" ON "magic_link_token"("token_hash");

-- CreateIndex
CREATE INDEX "magic_link_token_account_id_purpose_idx" ON "magic_link_token"("account_id", "purpose");

-- CreateIndex
CREATE INDEX "refresh_token_family_user_id_idx" ON "refresh_token_family"("user_id");

-- CreateIndex
CREATE INDEX "refresh_token_family_expires_at_idx" ON "refresh_token_family"("expires_at");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");

-- AddForeignKey
ALTER TABLE "account_setup_token" ADD CONSTRAINT "account_setup_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_link_token" ADD CONSTRAINT "magic_link_token_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "customer_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "refresh_token_family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
