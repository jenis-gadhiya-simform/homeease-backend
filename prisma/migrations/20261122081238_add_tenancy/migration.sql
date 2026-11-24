-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "member_role" AS ENUM ('OWNER', 'MANAGER', 'RECEPTIONIST', 'STAFF');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "address" TEXT,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "member_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "request_id" TEXT,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "membership_user_id_idx" ON "membership"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenant_id_user_id_key" ON "membership"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_entity_type_entity_id_created_at_idx" ON "audit_log"("tenant_id", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- One ACTIVE Owner per business (F04 rule, needed by onboarding).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "membership_one_owner_per_tenant"
  ON "membership" ("tenant_id")
  WHERE "role" = 'OWNER' AND "status" = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Database roles (F01). Migrations run as the owner; the app switches to
-- slotwise_app on connect (PrismaService), so row-level security applies to
-- it. slotwise_admin (BYPASSRLS) is used only by platform-admin and job code
-- (AdminPrismaService). Roles are cluster-wide: create them once.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'slotwise_app') THEN
    CREATE ROLE slotwise_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'slotwise_admin') THEN
    CREATE ROLE slotwise_admin NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- The migrating (login) user may switch to both roles.
GRANT slotwise_app, slotwise_admin TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO slotwise_app, slotwise_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO slotwise_app;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO slotwise_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO slotwise_app, slotwise_admin;
-- Tables created by later migrations (run by the same user) get the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO slotwise_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO slotwise_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO slotwise_app, slotwise_admin;
-- Prisma's bookkeeping is the migrator's business only (absent in the shadow database).
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM slotwise_app, slotwise_admin;
  END IF;
END
$$;

-- Audit log is append-only for the app (F09).
REVOKE UPDATE, DELETE ON "audit_log" FROM slotwise_app;

-- ---------------------------------------------------------------------------
-- Row-level security. The current tenant is set per transaction by
-- TenantPrismaService: SELECT set_config('app.tenant_id', $1, true).
-- Unset (or reset to '' after a transaction) it matches nothing.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

GRANT EXECUTE ON FUNCTION app_current_tenant_id(), app_current_user_id()
  TO slotwise_app, slotwise_admin;

ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;
-- In its tenant; also readable by its own user (to list their businesses).
CREATE POLICY tenant_isolation ON "membership"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());
CREATE POLICY own_memberships ON "membership" FOR SELECT
  USING ("user_id" = app_current_user_id());

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_log"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());
