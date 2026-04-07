import { getDb, closeDb } from '../src/storage/sqlite.js';

const db = getDb();
const result = db.prepare('DELETE FROM predictions').run();
console.log(`Deleted ${result.changes} predictions`);
closeDb();
