-- AlterTable: adiciona lineItemId (discrimina itens do mesmo produto no mesmo pedido,
-- evitando que dois itens distintos colapsem num único Rental via upsert)
ALTER TABLE "rentals" ADD COLUMN "lineItemId" TEXT NOT NULL DEFAULT '0';

-- Troca a unicidade pra incluir lineItemId. A original foi criada como ÍNDICE único
-- (via db push, não migrate) — não existe como CONSTRAINT nomeada, por isso DROP INDEX.
DROP INDEX "rentals_storeId_orderId_productId_key";
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_storeId_orderId_productId_lineItemId_key" UNIQUE ("storeId", "orderId", "productId", "lineItemId");

-- Índices de apoio pros 3 critérios de filtro do board Kanban (GET /api/rentals)
CREATE INDEX "rentals_storeId_orderCreatedAt_idx" ON "rentals"("storeId", "orderCreatedAt");
CREATE INDEX "rentals_storeId_reservationStart_idx" ON "rentals"("storeId", "reservationStart");
CREATE INDEX "rentals_storeId_reservationEnd_idx" ON "rentals"("storeId", "reservationEnd");
