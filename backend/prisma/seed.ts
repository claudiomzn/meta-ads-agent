import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('demo1234', 10);

  const user = await prisma.user.upsert({
    where: { email: 'demo@metaads.com' },
    update: {},
    create: {
      email: 'demo@metaads.com',
      password,
      name: 'Usuário Demo',
    },
  });

  const campaign = await prisma.campaign.upsert({
    where: { id: 'seed-campaign-1' },
    update: {},
    create: {
      id: 'seed-campaign-1',
      userId: user.id,
      name: 'Campanha Exemplo — Lançamento Produto X',
      product: 'Produto X',
      objective: 'LEAD_GENERATION',
      budget: 3000,
      status: 'draft',
    },
  });

  await prisma.adSet.upsert({
    where: { id: 'seed-adset-1' },
    update: {},
    create: {
      id: 'seed-adset-1',
      campaignId: campaign.id,
      name: 'Público Frio — Interesses',
      dailyBudget: 50,
      targeting: JSON.stringify({
        age_min: 25,
        age_max: 45,
        genders: [1, 2],
        geo_locations: { countries: ['BR'] },
        interests: [{ id: '6003139266461', name: 'Marketing digital' }],
      }),
      optimizationGoal: 'LEAD_GENERATION',
    },
  });

  await prisma.copy.upsert({
    where: { id: 'seed-copy-1' },
    update: {},
    create: {
      id: 'seed-copy-1',
      userId: user.id,
      campaignId: campaign.id,
      format: 'Feed',
      framework: 'AIDA',
      headline: 'Descubra o método que mudou o mercado',
      body: 'Mais de 10.000 clientes já transformaram seus resultados com o Produto X. Comece hoje e veja a diferença em 30 dias.',
      cta: 'Saiba Mais',
      score: 85,
    },
  });

  console.log('✅ Seed concluído. Usuário demo:', user.email, '/ Senha: demo1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
