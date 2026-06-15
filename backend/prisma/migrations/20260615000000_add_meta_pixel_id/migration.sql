-- Integração com Pixel do Meta: salva o ID do pixel criado/conectado para a conta
ALTER TABLE "MCPConnection" ADD COLUMN "metaPixelId" TEXT;
