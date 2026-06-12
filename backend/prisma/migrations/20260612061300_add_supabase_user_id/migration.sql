-- Identidade unificada: liga a conta deste backend ao usuário do Supabase (login principal do AdsGenius)
ALTER TABLE "User" ADD COLUMN "supabaseUserId" TEXT;
CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");
