import { expect, it } from 'vitest';
import { Queue, getDefaultQueue } from '../src/index.js';

it('tanpa env -> error yang menyebut ALDARETH_DB_URL', () => {
    delete process.env.ALDARETH_DB_URL;
    expect(() => getDefaultQueue()).toThrow(/ALDARETH_DB_URL/);
});

it('env cukup untuk static dispatch, tanpa createAldareth()', () => {
    process.env.ALDARETH_DB_URL = 'mysql://root:secret@127.0.0.1:3306/aldareth';
    expect(getDefaultQueue()).toBeInstanceOf(Queue);
});