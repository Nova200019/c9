/**
 * database-connector.ts
 *
 * Connects to external databases dynamically to execute read-only queries
 * or managed writes via the AI sub-agents.
 * Supported: PostgreSQL, MySQL, SQLite, MongoDB, InfluxDB, Redis
 */

import { Client } from "pg";
import mysql from "mysql2/promise";
import Database from "better-sqlite3";
import { InfluxDB } from "@influxdata/influxdb-client";
import Redis from "ioredis";

export type DbType = "postgres" | "mysql" | "sqlite" | "influxdb" | "redis";

export interface DbConnectionConfig {
  type: DbType;
  uri?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  sqlitePath?: string; // for sqlite
  token?: string;      // for influx
  org?: string;        // for influx
}

export async function queryDatabase(config: DbConnectionConfig, query: string, params: unknown[] = []): Promise<any> {
  try {
    switch (config.type) {
      case "postgres": {
        const client = new Client({ connectionString: config.uri, host: config.host, port: config.port, user: config.user, password: config.password, database: config.database });
        await client.connect();
        const res = await client.query(query, params);
        await client.end();
        return res.rows;
      }
      
      case "mysql": {
        const connection = await mysql.createConnection({ uri: config.uri, host: config.host, port: config.port, user: config.user, password: config.password, database: config.database });
        const [rows] = await connection.execute(query, params as any[]);
        await connection.end();
        return rows;
      }

      case "sqlite": {
        if (!config.sqlitePath) throw new Error("SQLite requires sqlitePath");
        const db = new Database(config.sqlitePath, { readonly: query.trim().toLowerCase().startsWith("select") });
        const stmt = db.prepare(query);
        let result;
        if (query.trim().toLowerCase().startsWith("select") || query.trim().toLowerCase().startsWith("pragma")) {
            result = stmt.all(...params);
        } else {
            result = stmt.run(...params);
        }
        db.close();
        return result;
      }

      case "redis": {
        let redis: Redis;
        if (config.uri) {
          redis = new Redis(config.uri);
        } else {
          redis = new Redis({ host: config.host || "localhost", port: config.port || 6379, password: config.password });
        }
        // basic command parsing: "GET key", "SET key val"
        const parts = query.split(" ");
        const cmd = parts[0];
        const args = parts.slice(1);
        // @ts-ignore
        const result = await redis[cmd.toLowerCase()](...args);
        redis.quit();
        return result;
      }

      case "influxdb": {
        if (!config.uri || !config.token || !config.org) throw new Error("InfluxDB requires uri, token, and org");
        const influxDB = new InfluxDB({ url: config.uri, token: config.token });
        const queryApi = influxDB.getQueryApi(config.org);
        const rows: any[] = [];
        
        await new Promise<void>((resolve, reject) => {
          queryApi.queryRows(query, {
            next(row, tableMeta) {
              rows.push(tableMeta.toObject(row));
            },
            error(error) {
              reject(error);
            },
            complete() {
              resolve();
            },
          });
        });
        return rows;
      }
        
      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }
  } catch (err: any) {
    return { error: true, message: err.message || "Database query failed" };
  }
}
