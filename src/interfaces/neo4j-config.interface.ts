import { Config } from 'neo4j-driver';

export type Neo4jScheme =
  | 'neo4j'
  | 'neo4j+s'
  | 'neo4j+scc'
  | 'bolt'
  | 'bolt+s'
  | 'bolt+scc';

export interface Neo4jConfig {
  scheme: Neo4jScheme;
  host: string;
  port: number | string;
  username: string;
  password: string;
  database?: string;
  options?: Config;
  /**
   * If the driver could not establish a connection to the Neo4j server
   * after the specified number of milliseconds, an error will be thrown.
   * @default 60000
   */
  verifyConnectionTimeout?: number;
}
