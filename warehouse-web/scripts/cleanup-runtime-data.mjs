import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  console.error("缺少 DATABASE_URL，无法清理运行期数据。");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const now = new Date();
  const [requests, sessions] = await prisma.$transaction([
    prisma.businessRequest.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.userSession.deleteMany({ where: { expiresAt: { lte: now } } })
  ]);
  console.log(`已清理 ${requests.count} 条过期防重复记录、${sessions.count} 条过期会话。`);
} finally {
  await prisma.$disconnect();
}
