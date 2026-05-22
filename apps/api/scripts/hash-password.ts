import { createInterface } from "node:readline";
import bcrypt from "bcryptjs";

async function main() {
  const envPassword = process.env.ADMIN_PASSWORD;

  if (envPassword) {
    const hash = await bcrypt.hash(envPassword, 12);
    process.stdout.write(hash + "\n");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  rl.question("Password: ", async (input) => {
    rl.close();

    if (!input.trim()) {
      process.stderr.write("Error: Password cannot be empty\n");
      process.exit(1);
    }

    const hash = await bcrypt.hash(input.trim(), 12);
    process.stdout.write(hash + "\n");
  });
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
