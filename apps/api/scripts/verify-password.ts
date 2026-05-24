import bcrypt from "bcryptjs";

async function main() {
  const password = process.env.ADMIN_PASSWORD;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!password) {
    throw new Error("ADMIN_PASSWORD is required");
  }

  if (!passwordHash) {
    throw new Error("ADMIN_PASSWORD_HASH is required");
  }

  const matches = await bcrypt.compare(password, passwordHash);
  process.stdout.write(`Password matches hash: ${matches}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
