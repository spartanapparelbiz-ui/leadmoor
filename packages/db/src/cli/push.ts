import { openDb } from '../client.js';

const handle = openDb();
await handle.migrate();
console.log(`schema applied via ${handle.driver}`);
await handle.close();
