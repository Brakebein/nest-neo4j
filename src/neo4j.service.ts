import { Injectable, Inject, OnApplicationShutdown } from '@nestjs/common';
import neo4j, {
  Driver,
  Record as IRecord,
  Session,
  isDate,
  isDateTime,
  isDuration,
  isInt,
  isLocalDateTime,
  isLocalTime,
  isPoint,
  isTime,
  QueryResult,
} from 'neo4j-driver';
import { Neo4jConfig } from './interfaces/neo4j-config.interface';
import { NEO4J_OPTIONS, NEO4J_DRIVER } from './neo4j.constants';

@Injectable()
export class Neo4jService implements OnApplicationShutdown {
  private readonly config: Neo4jConfig;
  private readonly driver: Driver;

  constructor(
    @Inject(NEO4J_OPTIONS) config: Neo4jConfig,
    @Inject(NEO4J_DRIVER) driver: Driver,
  ) {
    this.driver = driver;
    this.config = config;
  }

  /**
   * Get Neo4j driver instance to access the full API of _neo4j-driver_.
   */
  getDriver(): Driver {
    return this.driver;
  }

  getConfig(): Neo4jConfig {
    return { ...this.config };
  }

  onApplicationShutdown(): Promise<void> {
    return this.driver.close();
  }

  /**
   * Acquire a READ session.
   */
  getReadSession(database?: string): Session {
    return this.driver.session({
      database: database || this.config.database,
      defaultAccessMode: neo4j.session.READ,
    });
  }

  /**
   * Acquire a WRITE session.
   */
  getWriteSession(database?: string): Session {
    return this.driver.session({
      database: database || this.config.database,
      defaultAccessMode: neo4j.session.WRITE,
    });
  }

  /**
   * READ transaction without modifying database and return raw query result.
   */
  async readRaw(
    cypher: string,
    params?: Record<string, any>,
    database?: string,
  ): Promise<QueryResult> {
    const session = this.getReadSession(database);

    try {
      return await session.executeRead((tx) => tx.run(cypher, params));
    } catch (e) {
      throw e;
    } finally {
      await session.close();
    }
  }

  /**
   * READ transaction without modifying database and return extracted records.
   */
  async read<T = any>(
    cypher: string,
    params?: Record<string, any>,
    database?: string,
  ): Promise<T[]> {
    const result = await this.readRaw(cypher, params, database);
    return Neo4jService.extractRecords<T>(result.records);
  }

  /**
   * WRITE transaction that modifies database and return raw query result.
   */
  async writeRaw(
    cypher: string,
    params?: Record<string, any>,
    database?: string,
  ): Promise<QueryResult> {
    const session = this.getWriteSession(database);

    try {
      return await session.executeWrite((tx) => tx.run(cypher, params));
    } catch (e) {
      throw e;
    } finally {
      await session.close();
    }
  }

  /**
   * WRITE transaction that modifies database and return extracted records.
   */
  async write<T = any>(
    cypher: string,
    params?: Record<string, any>,
    database?: string,
  ): Promise<T[]> {
    const result = await this.writeRaw(cypher, params, database);
    return Neo4jService.extractRecords<T>(result.records);
  }

  /**
   * Call multiple statements in one transaction. Returns list of raw query results.
   */
  async multipleStatementsRaw(
    statements: { statement: string; parameters: Record<string, any> }[],
  ): Promise<QueryResult[]> {
    const session = this.getWriteSession();
    const txc = session.beginTransaction();

    try {
      const results: QueryResult[] = [];

      for (const s of statements) {
        const result = await txc.run(s.statement, s.parameters);
        results.push(result);
      }

      await txc.commit();
      return results;
    } catch (e) {
      await txc.rollback();
      throw e;
    } finally {
      await session.close();
    }
  }

  /**
   * Call multiple statements in one transaction. Returns list of extracted records.
   */
  async multipleStatements(
    statements: { statement: string; parameters: Record<string, any> }[],
  ): Promise<any[][]> {
    const results = await this.multipleStatementsRaw(statements);
    return results.map((result) => Neo4jService.extractRecords(result.records));
  }

  /**
   * Extract and convert records returned by neo4j-driver.
   */
  static extractRecords<T = any>(data: IRecord[]): T[] {
    if (!data) {
      return [];
    }

    if (!Array.isArray(data)) {
      return data;
    }

    return data.map((record) => {
      const obj = {};

      record.keys.forEach((key) => {
        obj[key] = this.convertValues(record.get(key));
      });

      return obj as T;
    });
  }

  private static convertValues(value) {
    if (value === null) {
      return value;
    }

    // neo4j integers
    if (isInt(value)) {
      if (neo4j.integer.inSafeRange(value)) {
        return value.toNumber();
      } else {
        return value.toString();
      }
    }

    // neo4j date, time, etc.
    if (
      isDate(value) ||
      isDateTime(value) ||
      isLocalTime(value) ||
      isLocalDateTime(value) ||
      isTime(value) ||
      isDuration(value) ||
      isPoint(value)
    ) {
      return value.toString();
    }

    // Spatial
    if (isPoint(value)) {
      switch (value.srid.toNumber()) {
        case 4326:
          return { longitude: value.y, latitude: value.x };

        case 4979:
          return { longitude: value.y, latitude: value.x, height: value.z };

        default:
          return this.convertValues({ x: value.x, y: value.y, z: value.z });
      }
    }

    // neo4j Node object
    if (value instanceof neo4j.types.Node) {
      value = value.properties;
    }

    // recursive array
    if (Array.isArray(value)) {
      return value.map((v) => this.convertValues(v));
    }

    // recursive object
    if (typeof value === 'object') {
      for (const key of Object.keys(value)) {
        value[key] = this.convertValues(value[key]);
      }
      return value;
    }

    return value;
  }

  /**
   * Look for empty arrays returned by Neo4j and clean them, if there is `null` inside.
   *
   * Sometimes, if the cypher query contains `OPTIONAL MATCH node` in combination with
   * `collect({key: node.value}) AS values`, the resulting array may be filled with one
   * object with `null` values: `[{key: null}]`. This method reduces the array to `[]`
   * by calling `removeEmptyArrays(data, 'values', 'key')`.
   *
   * @param data
   * @param arrayKey Property key of the array to check
   * @param checkKey Property key of first array element to check against `null`
   */
  static removeEmptyArrays<T>(
    data: T[],
    arrayKey: string,
    checkKey: string,
  ): T[] {
    for (let i = 0, l = data.length; i < l; i++) {
      if (
        data[i][arrayKey] &&
        Array.isArray(data[i][arrayKey]) &&
        data[i][arrayKey][0]
      ) {
        if (data[i][arrayKey][0][checkKey] === null) {
          data[i][arrayKey] = [];
        }
      }

      for (const key in data[i]) {
        if (data[i].hasOwnProperty(key) && Array.isArray(data[i][key])) {
          this.removeEmptyArrays(data[i][key] as any, arrayKey, checkKey);
        }
      }
    }

    return data;
  }
}
