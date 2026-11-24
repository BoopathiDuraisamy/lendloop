// Prints an n8n credential import file for the "LendLoop SMTP" credential,
// built from SMTP_* env vars (n8n/smtp.env). Used only by the one-shot
// `n8n-smtp` compose service; n8n encrypts it with N8N_ENCRYPTION_KEY on import.
// The main n8n container never receives these variables.
//   --placeholder  emit a dummy credential (lets workflows publish in mock mode;
//                  replaced by the real one when you run the n8n-smtp service)
const placeholder = process.argv.includes("--placeholder");
if (placeholder) {
  process.env.SMTP_HOST = "smtp.invalid";
  process.env.SMTP_USER = "not-configured";
  process.env.SMTP_PASS = "not-configured";
}
const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")} in n8n/smtp.env`);
  process.exit(1);
}
const port = Number(process.env.SMTP_PORT || 465);
process.stdout.write(
  JSON.stringify([
    {
      id: "lendloopSmtp0001", // referenced by the workflows
      name: "LendLoop SMTP",
      type: "smtp",
      data: {
        host: process.env.SMTP_HOST,
        port,
        secure: (process.env.SMTP_SECURE ?? String(port === 465)) === "true",
        user: process.env.SMTP_USER,
        password: process.env.SMTP_PASS,
      },
    },
  ]),
);
