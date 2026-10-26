import 'dotenv/config';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from './entities';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'robot',
  password: process.env.DB_PASS ?? 'robot',
  database: process.env.DB_NAME ?? 'robot_platform',
  entities: DATABASE_ENTITIES,
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  migrationsTableName: 'schema_migrations',
  synchronize: false,
});
