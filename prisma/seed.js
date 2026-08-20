const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

const categories = ['Electrician', 'Plumber', 'Tutor', 'Photographer', 'Cook'];

// শুরুতে অ্যাডমিন প্যানেলে ঢোকার জন্য একটা ডিফল্ট অ্যাডমিন অ্যাকাউন্ট — প্রোডাকশনে
// যাওয়ার আগে অবশ্যই পাসওয়ার্ড বদলান (বা এই সিড ব্লক মুছে ফেলুন)
async function seedAdmin() {
  const phone = '01700000000';
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) return;

  const passwordHash = await bcrypt.hash('admin1234', 10);
  await prisma.user.create({
    data: {
      phone,
      name: 'Admin',
      passwordHash,
      role: 'ADMIN',
      isVerified: true,
    },
  });
  console.log('Seeded default admin — phone: 01700000000, password: admin1234 (বদলে ফেলুন!)');
}

async function main() {
  for (const name of categories) {
    await prisma.serviceCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log('Seeded service categories:', categories.join(', '));

  await seedAdmin();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
