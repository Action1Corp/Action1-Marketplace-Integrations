function createInMemoryTicketingDb() {
  const tables = new Map();
  const nextIds = new Map();
  const calls = [];

  function tableRows(name) {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  }

  function parseTable(sql) {
    const match = String(sql).match(/\b(?:FROM|INTO|UPDATE|DELETE FROM)\s+([a-z0-9_]+)/i);
    if (!match) throw new Error(`Unsupported SQL table: ${sql}`);
    return match[1];
  }

  function whereEntries(sql, params) {
    const whereMatch = /\bWHERE\b/i.exec(sql);
    if (!whereMatch) return [];
    const whereSql = sql.slice(whereMatch.index + whereMatch[0].length).split(/\s+ORDER\s+BY\s+/i)[0];
    const names = [...whereSql.matchAll(/\b([a-z0-9_]+)\s*=\s*\?/gi)].map((match) => match[1]);
    return names.map((name, index) => [name, params[index]]);
  }

  function selectedRows(sql, params) {
    const name = parseTable(sql);
    const filters = whereEntries(sql, params);
    let rows = tableRows(name).filter((row) => filters.every(([key, value]) => String(row[key] ?? '') === String(value ?? '')));
    const orderMatch = sql.match(/\bORDER\s+BY\s+([\s\S]+)$/i);
    if (orderMatch) {
      const orderFields = orderMatch[1].split(',').map((part) => {
        const field = part.trim().match(/(?:LOWER\()?([a-z0-9_]+)\)?(?:\s+(ASC|DESC))?/i);
        return field ? { name: field[1], direction: String(field[2] || 'ASC').toUpperCase() } : null;
      }).filter(Boolean);
      rows = rows.slice().sort((left, right) => {
        for (const field of orderFields) {
          const a = String(left[field.name] ?? '').toLowerCase();
          const b = String(right[field.name] ?? '').toLowerCase();
          if (a !== b) return (a < b ? -1 : 1) * (field.direction === 'DESC' ? -1 : 1);
        }
        return 0;
      });
    }
    return rows;
  }

  const db = {
    calls,
    tables,
    async get(sql, params = []) {
      calls.push({ method: 'get', sql, params: [...params] });
      return selectedRows(sql, params)[0] || null;
    },
    async all(sql, params = []) {
      calls.push({ method: 'all', sql, params: [...params] });
      return selectedRows(sql, params).map((row) => ({ ...row }));
    },
    async run(sql, params = []) {
      calls.push({ method: 'run', sql, params: [...params] });
      const table = parseTable(sql);
      const rows = tableRows(table);
      const insert = sql.match(/^\s*INSERT\s+INTO\s+[a-z0-9_]+\s*\(([^)]+)\)\s*VALUES/i);
      if (insert) {
        const columns = insert[1].split(',').map((name) => name.trim());
        const row = Object.fromEntries(columns.map((name, index) => [name, params[index]]));
        if (row.id === undefined) {
          const next = (nextIds.get(table) || 0) + 1;
          nextIds.set(table, next);
          row.id = next;
        }
        rows.push(row);
        return { changes: 1, lastID: row.id };
      }

      const update = sql.match(/^\s*UPDATE\s+[a-z0-9_]+\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
      if (update) {
        const fields = update[1].split(',').map((part) => part.trim().match(/^([a-z0-9_]+)\s*=\s*\?/i)?.[1]).filter(Boolean);
        const filterSql = `WHERE ${update[2]}`;
        const filterEntries = whereEntries(filterSql, params.slice(fields.length));
        const selected = rows.filter((row) => filterEntries.every(([key, value]) => String(row[key] ?? '') === String(value ?? '')));
        for (const row of selected) fields.forEach((field, index) => { row[field] = params[index]; });
        return { changes: selected.length };
      }

      const deletion = sql.match(/^\s*DELETE\s+FROM\s+[a-z0-9_]+\s+WHERE\s+([\s\S]+)$/i);
      if (deletion) {
        const filters = whereEntries(`WHERE ${deletion[1]}`, params);
        const kept = rows.filter((row) => !filters.every(([key, value]) => String(row[key] ?? '') === String(value ?? '')));
        const changes = rows.length - kept.length;
        tables.set(table, kept);
        return { changes };
      }

      throw new Error(`Unsupported SQL operation: ${sql}`);
    }
  };

  return { db, context: { db }, tables };
}

module.exports = { createInMemoryTicketingDb };
