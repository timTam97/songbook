import { describe, expect, it } from 'vitest';
import { decideJump } from './jump.ts';

const book96 = Array.from({ length: 96 }, (_, k) => k + 1);

describe('decideJump', () => {
  it('opens a two-digit hymn as soon as it is typed', () => {
    expect(decideJump('25', book96)).toEqual({ kind: 'go', number: 25 });
    expect(decideJump('96', book96)).toEqual({ kind: 'go', number: 96 });
    expect(decideJump('10', book96)).toEqual({ kind: 'go', number: 10 });
  });

  it('waits on a digit that could still grow, but knows which hymn it is', () => {
    expect(decideJump('2', book96)).toEqual({ kind: 'wait', number: 2 });
    expect(decideJump('9', book96)).toEqual({ kind: 'wait', number: 9 });
  });

  it('flags numbers that do not exist and cannot grow into one', () => {
    expect(decideJump('97', book96)).toEqual({ kind: 'invalid' });
    expect(decideJump('0', book96)).toEqual({ kind: 'invalid' });
    expect(decideJump('100', book96)).toEqual({ kind: 'invalid' });
  });

  it('handles gaps left by excluded songs', () => {
    const gappy = [1, 2, 4, 12];
    expect(decideJump('3', gappy)).toEqual({ kind: 'invalid' });
    expect(decideJump('1', gappy)).toEqual({ kind: 'wait', number: 1 });
    expect(decideJump('4', gappy)).toEqual({ kind: 'go', number: 4 });
  });

  it('opens single digits immediately in a book under ten songs', () => {
    expect(decideJump('7', [1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual({ kind: 'go', number: 7 });
  });

  it('is empty for an empty box', () => {
    expect(decideJump('', book96)).toEqual({ kind: 'empty' });
  });
});
