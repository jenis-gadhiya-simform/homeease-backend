-- AlterTable
ALTER TABLE "membership" ADD COLUMN     "staff_id" UUID;

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_tenant_id_active_idx" ON "staff"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "membership_staff_id_key" ON "membership"("staff_id");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- F04: staff calendars are tenant data. Grants come from the default
-- privileges set in add_tenancy; RLS limits the app role to its tenant.
-- ---------------------------------------------------------------------------
ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());
