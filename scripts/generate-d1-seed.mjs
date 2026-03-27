import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceFile = resolve(process.cwd(), '../resume-db/source/content.i18n.json');
const outputFile = resolve(process.cwd(), '../resume-db/db/seed.sql');

const raw = await readFile(sourceFile, 'utf8');
const content = JSON.parse(raw);

if (!content || typeof content !== 'object') {
  throw new Error('Invalid content.i18n.json payload');
}

const escapeSqlText = (text) => text.replace(/'/g, "''");

const statements = [
  '-- Generated from src/data/content.i18n.json',
  "BEGIN TRANSACTION;",
  "DELETE FROM resume_i18n_content;",
];

for (const [langCode, payload] of Object.entries(content)) {
  const payloadJson = JSON.stringify(payload);
  const escapedPayload = escapeSqlText(payloadJson);
  const escapedLangCode = escapeSqlText(langCode);

  statements.push(
    `INSERT INTO resume_i18n_content (lang_code, payload, updated_at) VALUES ('${escapedLangCode}', json('${escapedPayload}'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`,
  );
}

statements.push('COMMIT;');
statements.push('');

await writeFile(outputFile, statements.join('\n'), 'utf8');
console.log(`Generated ${outputFile}`);
