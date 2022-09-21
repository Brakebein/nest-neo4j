import neo4j, { Driver, ServerInfo } from 'neo4j-driver';
import { Logger } from '@nestjs/common';
import {
  lastValueFrom,
  Subject,
  takeUntil,
  throwError,
  timeout,
  timer,
} from 'rxjs';
import { Neo4jConfig } from './interfaces/neo4j-config.interface';

export const createDriver = async (config: Neo4jConfig): Promise<Driver> => {
  const logger = new Logger('Neo4jModule');
  const driver$ = new Subject<Driver>();
  const options = Object.assign(
    { disableLosslessIntegers: true },
    config.options || {},
  );
  let reason;

  timer(0, 5000)
    .pipe(takeUntil(driver$))
    .subscribe(async () => {
      const driver = neo4j.driver(
        `${config.scheme}://${config.host}:${config.port}`,
        neo4j.auth.basic(config.username, config.password),
        options,
      );

      try {
        const serverInfo = await driver.verifyConnectivity({
          database: config.database,
        });
        logger.log('Neo4j Server: ' + printInfo(serverInfo));
        driver$.next(driver);
        driver$.complete();
      } catch (e) {
        logger.warn('Neo4j driver instantiation failed. Retry in 5 seconds...');
        reason = e;
      }
    });

  return lastValueFrom(
    driver$.pipe(
      timeout({
        each: 60000,
        with: () => {
          logger.error('Neo4j driver instantiation failed!');
          logger.error(reason);
          return throwError(() => reason);
        },
      }),
    ),
  );
};

function printInfo(info: ServerInfo): string {
  const output: string[] = [];
  Object.entries(info).forEach(([key, value]) => {
    if (value !== undefined) {
      const valueString = typeof value === 'string' ? `'${value}'` : value;
      output.push(`${key}: ${valueString}`);
    }
  });
  return `{ ${output.join(', ')} }`;
}
