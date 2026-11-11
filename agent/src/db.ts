import { postgres } from '@flue/postgres';
import { Pool } from 'pg';

// Flue creates and migrates its own flue_* tables on boot. Conversations,
// attachments and accepted submissions survive restarts in this database.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://standup:standup@localhost:5432/standup',
});

export default postgres({
  query: async (text, params) => (await pool.query(text, params as unknown[])).rows,
  transaction: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        query: async (text, params) => (await client.query(text, params as unknown[])).rows,
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
  close: () => pool.end(),
});
