import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Backend secrets live in backend/.env (gitignored). Never expose them.
dotenv.config({ path: path.join(__dirname, "..", ".env") });

export const PORT = Number(process.env.PORT) || 3000;
