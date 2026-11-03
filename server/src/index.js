import 'dotenv/config';
import { app } from './app.js';
import { db } from './db.js';
import { runMigrations } from './migrations.js';
const port=Number(process.env.PORT||3001);
runMigrations(db);
app.listen(port,()=>console.log(`Backend: http://localhost:${port}`));
