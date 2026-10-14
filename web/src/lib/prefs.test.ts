import { describe, expect, it } from 'vitest';
import { parseListView } from './prefs.ts';

describe('parseListView', () => {
  it('reads a stored compact view', () => {
    expect(parseListView('compact')).toBe('compact');
  });

  it('falls back to the regular view for anything else', () => {
    for (const raw of [null, '', 'regular', 'Compact', ' compact', 'dense']) expect(parseListView(raw)).toBe('regular');
  });
});
