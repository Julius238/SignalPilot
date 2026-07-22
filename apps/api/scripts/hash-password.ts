import bcrypt from "bcryptjs";

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d\d\$/;

async function main() {
  const envPassword = process.env.ADMIN_PASSWORD;

  if (!envPassword) {
    throw new Error(
      "ADMIN_PASSWORD is required. Generate a hash with ADMIN_PASSWORD='your-cleartext-password' pnpm auth:hash-password"
    );
  }

  if (BCRYPT_HASH_PATTERN.test(envPassword)) {
    throw new Error("ADMIN_PASSWORD must be the cleartext password, not an existing bcrypt hash.");
  }

  const hash = await bcrypt.hash(envPassword, 12);
  process.stdout.write(`ADMIN_PASSWORD_HASH='${hash}'\n`);
  process.stdout.write("Use this hash in .env, then login with the original cleartext password.\n");
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
