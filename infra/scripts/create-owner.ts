// Creates the first console owner. Run once after the first deploy (see infra/README.md):
//   docker compose --env-file /opt/triakshi/.env -f infra/docker-compose.yml run --rm worker \
//     pnpm exec tsx infra/scripts/create-owner.ts you@yourbrand.com "Your Name"
// Prints a one-time password and the TOTP secret (also as an otpauth:// URL). Add it to your authenticator app, then log in at console.<ROOT_DOMAIN>.
// Relative imports because infra/ is not a workspace package.
import { randomBytes } from "node:crypto";
import { closeDb, platformStaff, withConsole } from "../../packages/db/src/index";
import { Passwords, StaffAuth } from "../../packages/auth/src/index";

const [email, name] = process.argv.slice(2);
if (!email || !name) { console.error('usage: create-owner.ts <email> "<name>"'); process.exit(1); }

const password = process.env.OWNER_PASSWORD ?? randomBytes(15).toString("base64url");
const secret = StaffAuth.newTotpSecret();
const passwordHash = await Passwords.hash(password);

await withConsole((tx) => tx.insert(platformStaff).values({ email: email.trim().toLowerCase(), name, role: "owner", passwordHash, totpSecret: secret, totpEnabled: true }));
console.log(`Owner created: ${email}`);
if (!process.env.OWNER_PASSWORD) console.log(`Password (change it after login): ${password}`);
console.log(`TOTP secret: ${secret}`);
console.log(`otpauth URL: ${StaffAuth.totp(secret, email).toString()}`);
await closeDb();
