// Load .env before anything reads process.env. Import this first in every script.
import { config } from "dotenv";

config({ quiet: true });
