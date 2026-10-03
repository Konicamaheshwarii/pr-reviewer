import { DiffLine } from '../core/diff/models';
import { pairLines } from './diff-file.component';
import { splitInlineCode } from './inline-code.pipe';

const l = (type: DiffLine['type'], content: string): DiffLine => ({ type, content, oldLine: null, newLine: null });

describe('split view pairing', () => {
  it('pairs removed lines with the added lines that replace them', () => {
    const rows = pairLines([l('context', 'a'), l('del', 'b'), l('del', 'c'), l('add', 'B'), l('context', 'd'), l('add', 'e')]);
    expect(rows.map((r) => [r.left?.content ?? null, r.right?.content ?? null])).toEqual([
      ['a', 'a'], ['b', 'B'], ['c', null], ['d', 'd'], [null, 'e'],
    ]);
  });
});

describe('splitInlineCode', () => {
  it('splits backtick code spans out of comment text', () => {
    expect(splitInlineCode('Use `let` not `var`.')).toEqual([
      { code: false, text: 'Use ' }, { code: true, text: 'let' }, { code: false, text: ' not ' },
      { code: true, text: 'var' }, { code: false, text: '.' },
    ]);
    expect(splitInlineCode('no code')).toEqual([{ code: false, text: 'no code' }]);
  });
});
