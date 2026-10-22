import { expect, it } from 'vitest';
import { MysqlDriver } from '../src/drivers/mysql/mysql-driver.js';
import { MongoDriver } from '../src/drivers/mongodb/mongodb-driver.js';

it('mysql driver menolak URI dengan skema lain', () => {
    expect(() => new MysqlDriver('mongodb://127.0.0.1:27017/aldareth')).toThrow(/mysql/);
});

it('mongodb driver menolak URI dengan skema lain', () => {
    expect(() => new MongoDriver('mysql://root:secret@127.0.0.1:3306/aldareth')).toThrow(/mongodb/);
});

it('kedua driver menerima URI dengan skema yang benar', async () => {
    const mysql = new MysqlDriver('mysql://root:secret@127.0.0.1:3306/aldareth');
    const mongo = new MongoDriver('mongodb://127.0.0.1:27017/aldareth');
    await mysql.close();
    await mongo.close();
});
