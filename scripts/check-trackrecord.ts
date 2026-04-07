import { getTrackRecord } from '../src/analysis/resolve-predictions.js';
import { closeDb } from '../src/storage/sqlite.js';

const tr = getTrackRecord('nba');
console.log('TRACK RECORD (NBA, v2):');
console.log(JSON.stringify(tr, null, 2));
closeDb();
