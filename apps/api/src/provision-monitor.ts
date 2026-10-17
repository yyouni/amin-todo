import type pg from 'pg';

export async function provisionMonitor(pool: pg.Pool, password: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'todo_metrics'");
    if (!found.rowCount) await client.query('CREATE ROLE todo_metrics LOGIN');
    // Identifiers/passwords cannot be SQL parameters in ALTER ROLE; pg escapes them.
    await client.query(`ALTER ROLE todo_metrics PASSWORD ${client.escapeLiteral(password)}`);
    await client.query('ALTER ROLE todo_metrics SET default_transaction_read_only = on');
    await client.query('GRANT USAGE ON SCHEMA public TO todo_metrics');
    await client.query('GRANT SELECT ON public.page_view_hours TO todo_metrics');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
