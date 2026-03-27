import 'dotenv/config';
import { resolve } from 'node:path';
import { createContentRepository } from '../content-repository.js';

const dbPath = process.env.DB_PATH ?? '../resume-db/data/resume.db';
const jsonDataFilePath = resolve(
  process.cwd(),
  process.env.DATA_FILE_PATH ?? '../resume-db/source/content.i18n.json',
);

const repository = createContentRepository({
  dbPath,
  jsonDataFilePath,
  autoMigrateJsonToDb: false,
});

await repository.syncFromJson();
console.log(`Synced JSON data to SQLite: ${dbPath}`);
