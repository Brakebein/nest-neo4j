<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://kamilmysliwiec.com/public/nest-logo.png#1" alt="Nest Logo" />   </a>
  <a href="https://neo4j.com" target="_blank"><img src="https://dist.neo4j.com/wp-content/uploads/20140926224303/neo4j_logo-facebook.png" alt="Neo4j Logo" width="380"></a>
</p>

# Nest Neo4j

This repository provides [Neo4j](https://www.neo4j.com) integration for [NestJS](http://nestjs.com/) wrapping the official [neo4j-driver](https://github.com/neo4j/neo4j-javascript-driver).

It is a fork of [adam-cowley/nest-neo4j](https://github.com/adam-cowley/nest-neo4j) with some changes:

- the queried records are extracted to a simplified format
- non-standard properties (e.g. dates) are converted
- updated dependencies

## Installation

```bash
$ npm install @brakebein/nest-neo4j
```

## Setup

Register the Neo4j Module in your application using the `forRoot` method, passing the Neo4j connection information as an object.
Specific Neo4j settings (refer to [neo4j-driver](https://github.com/neo4j/neo4j-javascript-driver)) can be passed via `options`.

```ts
import { Module } from '@nestjs/common';
import { Neo4jModule } from '@brakebein/nest-neo4j';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    Neo4jModule.forRoot({
      scheme: 'neo4j',
      host: 'localhost',
      port: 7687,
      username: 'neo4j',
      password: 'neo',
      options: {
        disableLosslessIntegers: true,
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

Alternatively, you can use `forRootAsync` to access information dynamically via `ConfigService`:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Neo4jModule } from '@brakebein/nest-neo4j';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    Neo4jModule.forRootAsync({
      useFactory: async (configService: ConfigService) => ({
        scheme: configService.get('neo4j.scheme'),
        host: configService.get('neo4j.host'),
        port: configService.get('neo4j.port'),
        username: configService.get('neo4j.username'),
        password: configService.get('neo4j.password'),
        database: configService.get('neo4j.database'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

If the Neo4j instance is unavailable, connection is not possible.
Driver instantiation will be re-invoked a few times before throwing an error (useful in cases like server startup when node application is live earlier than the Neo4j database instance).

## Querying Neo4j

The `Neo4jService` is `@Injectable`, so can be passed into any constructor:

```ts
import { Neo4jService } from '@brakebein/nest-neo4j';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly neo4j: Neo4jService,
  ) {}

  @Get()
  async getHello(): Promise<any> {
    const results = await this.neo4j.read(`MATCH (n) RETURN count(n) AS count`);

    return `There are ${results[0].count} nodes in the database`;
  }
}
```

## Methods

The query results returned by _neo4j-driver_ are mapped to objects that correlate with identifiers within the `RETURN` clause and the node's properties.
To access the raw query results, use the respective methods, e.g. `.readRaw()`.

#### `.read(cypher: string, params?: Record<string, any>, database?: string)`

A very simple read transaction that expects a cypher statement and (optionally) query parameters.

Returns an array of objects, where the object's property names correlate with identifiers within the `RETURN` clause.

```ts
const query = `
  MATCH (p:Person {name: $name})-[:HAS_ADDRESS]->(add:Address)
  RETURN p.name AS name, add AS address
`;

const params = {
  name: 'Alex'
};

const results = await this.neo4j.read(query, params);
console.log(results);

// console.log(results)
// [
//   {
//     name: 'Alex',
//     address: {
//       ZIP: '10178',
//       number: '1',
//       town: 'Berlin',
//       street: 'Alexanderplatz'
//     }
//   }
// ]
```

Use `.readRaw()` to get the raw query results.

#### `.write(cypher: string, params?: Record<string, any>, database?: string)`

Very similar to `.read()` (see for details) except that it expects a cypher statement that modifies the database.

Use `.writeRaw()` to get the raw query results.

#### `.multipleStatements(statements: { statement: string; parameters: Record<string, any> }[])`

Execute multiple cypher queries within one transaction. A fail of one statement will lead to the rollback of the whole transaction.

Returns an array of arrays of objects (similar to `.read()` or `.write()`).

```ts
const statements = [{
  statement: `CREATE ...`,
  parameters: {}
}, {
  statement: `MATCH ... CREATE (n:Node $map) ...`,
  parameters: { map: { value: 'foo' } }
}];

const results = await this.neo4j.multipleStatements(statements);
// handle results
```

Use `.multipleStatementsRaw()` to get an array of the raw query results.

#### `.getDriver()`

Get the driver instance to access the full API of [neo4j-driver](https://github.com/neo4j/neo4j-javascript-driver).

#### `.getConfig()`

Get configuration as provided with `Neoj4Module`.

#### `.getReadSession(database?: string)`

Acquire a READ session to execute, e.g., [explicit transactions](https://github.com/neo4j/neo4j-javascript-driver#explicit-transactions).

#### `.getWriteSession(database?: string)`

Acquire a WRITE session to execute, e.g., [explicit transactions](https://github.com/neo4j/neo4j-javascript-driver#explicit-transactions).

#### `.extractRecords<T = any>(data: Record[]): T[]()`

Used internally to extract and convert the returned records by neo4j-driver to a more simplified format.
It converts non-standard values, like date, time, etc., to strings as well as Neo4j integers, if they are outside the safe range.

Takes an array of Neo4j records `Record[]` and returns an array of objects.

```ts
import { Neo4jService } from './neo4j.service';

const query = `
  MATCH (p:Person {name: "Alex"})-[:HAS_ADDRESS]->(add:Address)
  RETURN p.name AS name, add AS address
`;

// query results returned by neo4j-driver
// {
//   records: [
//     Record {
//       keys: [ 'name', 'address' ],
//       length: 2,
//       _fields: [
//         'Alex',
//         Node {
//           identity: 1,
//           labels: [ 'Address' ],
//           properties: {
//             ZIP: '10178',
//             number: '1',
//             town: 'Berlin',
//             street: 'Alexanderplatz'
//           }
//         }
//       ]
//       _fieldLookup: { name: 0, address: 1 }
//     }
//   ],
//   summary: ResultSummary {...}
// }

extractRecords(queryResults.records);

// simplified records returned by neo4j-request
// {
//   name: 'Alex',
//   address: {
//     ZIP: '10178',
//     number: '1',
//     town: 'Berlin',
//     street: 'Alexanderplatz'
//   }
// }
```

#### `.removeEmptyArrays<T>(data: T[], arrayKey: string, checkKey: string): T[]`

Look for empty arrays returned by Neo4j and clean them, if there is `null` inside.

Sometimes, if the cypher query contains `OPTIONAL MATCH node` in combination with `collect({key: node.value}) AS values`, the resulting array may be filled with one object with `null` values: `[{key: null}]`. This method reduces the array to `[]` by calling `removeEmptyArrays(data, 'values', 'key')`.

```ts
const query = `
  MATCH (p:Person {name: "Alex"})-[:HAS_ADDRESS]->(add:Address)
  OPTIONAL MATCH (p)-[:HAS_FRIEND]->(f:Person)-[:HAS_ADDRESS]->(fAddr:Address)
  RETURN p.name AS name,
         add AS address,
         collect({name: f.name, address: fAddr}) AS friends
`;

const results = await this.neo4j.read(query);
console.log(results);

// [
//   {
//     name: 'Alex',
//     address: {
//       ZIP: '10178',
//       number: '1',
//       town: 'Berlin',
//       street: 'Alexanderplatz'
//     },
//     friends: [ { address: null, name: null } ]
//   }
// ]

const resultsCleaned = this.neo4j.removeEmptyArrays(results, 'friends', 'name');
console.log(resultsCleaned);

// [
//   {
//     name: 'Alex',
//     address: {
//       ZIP: '10178',
//       number: '1',
//       town: 'Berlin',
//       street: 'Alexanderplatz'
//     },
//     friends: []
//   }
// ]
```
