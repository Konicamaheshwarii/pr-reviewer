import { createUnifiedDiff } from '../diff/generator';
import { DiffFile } from '../diff/models';
import { parseUnifiedDiff } from '../diff/parser';
import { tokenize, codeOnly } from '../diff/tokenizer';
import { SAMPLES } from '../samples';
import { RULES, runRules } from './rules';

/** A file whose every line is added. */
function added(path: string, code: string): DiffFile {
  return parseUnifiedDiff(createUnifiedDiff('', code.endsWith('\n') ? code : code + '\n', { oldPath: path })).files[0];
}

/** Lines (1-based) flagged by one rule. */
function hits(ruleId: string, path: string, code: string): number[] {
  return runRules(added(path, code)).filter((c) => c.ruleId === ruleId).map((c) => c.line);
}

function comment(ruleId: string, path: string, code: string) {
  return runRules(added(path, code)).find((c) => c.ruleId === ruleId);
}

describe('tokenizer', () => {
  it('colours keywords, strings, comments and numbers, and masks strings for rules', () => {
    const tokens = tokenize('const x = "a == b"; // TODO 42', 'ts');
    expect(tokens.find((t) => t.k === 'kw')?.v).toBe('const');
    expect(tokens.find((t) => t.k === 'str')?.v).toBe('"a == b"');
    expect(tokens.find((t) => t.k === 'com')?.v).toBe('// TODO 42');
    expect(codeOnly('if (a == "x == y") {} // b == c', 'ts')).toBe('if (a == "      ") {} ');
    expect(tokenize('<img src="a.png">', 'html').map((t) => t.k)).toEqual(['tag', '', 'attr', '', 'str', 'tag']);
  });
});

describe('rule engine', () => {
  it('has at least 12 rules with unique ids', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it('only looks at added lines, never at context or removed lines', () => {
    const file = parseUnifiedDiff(createUnifiedDiff('console.log(1);\nconst a = 1;\n', 'console.log(1);\nconst a = 2;\nconsole.log(2);\n', { oldPath: 'a.js' })).files[0];
    expect(runRules(file).filter((c) => c.ruleId === 'no-debug-output').map((c) => c.line)).toEqual([3]);
  });

  it('no-debug-output: console.log and Python print, but not console.error or test files', () => {
    expect(hits('no-debug-output', 'a.ts', 'console.log(x);\nconsole.error(e);\nlogger.log(y);')).toEqual([1]);
    expect(hits('no-debug-output', 'a.py', 'print("hi")\nlog.info("ok")')).toEqual([1]);
    expect(hits('no-debug-output', 'a.spec.ts', 'console.log(x);')).toEqual([]);
  });

  it('no-debugger: debugger statements and Python breakpoints', () => {
    expect(hits('no-debugger', 'a.js', 'debugger;\nconst debuggerMode = 1;\n// debugger')).toEqual([1]);
    expect(hits('no-debugger', 'a.py', 'import pdb; pdb.set_trace()\nbreakpoint()')).toEqual([1, 2]);
  });

  it('no-explicit-any: flags any types and suggests unknown', () => {
    expect(hits('no-explicit-any', 'a.ts', 'let a: any;\nconst b = c as any;\nfunction f(x: Array<any>) {}\nconst many = 1;\n// any time')).toEqual([1, 2, 3]);
    expect(comment('no-explicit-any', 'a.ts', 'let a: any = 1;')?.suggestion).toBe('let a: unknown = 1;');
    expect(hits('no-explicit-any', 'a.js', 'let a: any;')).toEqual([]);
  });

  it('todo-comment: TODO / FIXME only inside comments', () => {
    expect(hits('todo-comment', 'a.ts', '// TODO: fix\nconst s = "TODO";\n/* FIXME later */')).toEqual([1, 3]);
    expect(comment('todo-comment', 'a.py', '# FIXME: slow')?.title).toBe('Unresolved FIXME');
    expect(hits('todo-comment', 'a.html', '<!-- TODO: copy -->')).toEqual([1]);
  });

  it('empty-catch: empty catch blocks, empty .catch callbacks and except: pass', () => {
    expect(hits('empty-catch', 'a.ts', 'try { a(); } catch (e) {}\np.catch(() => {});\ntry {\n  b();\n} catch {\n}\ntry { c(); } catch (e) { log(e); }')).toEqual([1, 2, 5]);
    expect(hits('empty-catch', 'a.ts', 'try {\n  b();\n} catch {\n  // safe to ignore: optional feature\n}')).toEqual([]);
    expect(hits('empty-catch', 'a.py', 'try:\n    x()\nexcept ValueError:\n    pass')).toEqual([3]);
  });

  it('eqeqeq: loose equality outside strings, allowing == null', () => {
    expect(hits('eqeqeq', 'a.ts', 'if (a == b) {}\nif (a === b) {}\nif (a != null) {}\nconst s = "x == y";\nif (a != 1) {}')).toEqual([1, 5]);
    expect(comment('eqeqeq', 'a.js', 'if (a == b && c != d) {}')?.suggestion).toBe('if (a === b && c !== d) {}');
  });

  it('hardcoded-secret: known key formats and secret-looking assignments, not placeholders or env lookups', () => {
    const aws = 'AKIA' + 'Q'.repeat(16);
    expect(hits('hardcoded-secret', 'a.ts', `const k = "${aws}";`)).toEqual([1]);
    expect(comment('hardcoded-secret', 'a.ts', `const k = "${aws}";`)?.title).toContain('AWS');
    expect(hits('hardcoded-secret', 'a.py', 'DB_PASSWORD = "hunter2-prod"')).toEqual([1]);
    expect(hits('hardcoded-secret', 'cfg.json', '{ "apiKey": "abc123def456" }')).toEqual([1]);
    expect(hits('hardcoded-secret', 'a.ts', 'const password = "changeme";\nconst apiKey = process.env.API_KEY;\nconst token = "<your-token>";')).toEqual([]);
    expect(comment('hardcoded-secret', 'a.ts', 'const apiKey = "abc123def456";')?.severity).toBe('blocker');
  });

  it('angular-subscribe-leak: subscribe in components without takeUntilDestroyed', () => {
    const component = (body: string) => `@Component({ selector: 'x' })\nexport class X {\n  ngOnInit() {\n${body}\n  }\n}`;
    expect(hits('angular-subscribe-leak', 'x.component.ts', component('    this.a$.subscribe((v) => this.v = v);'))).toEqual([4]);
    expect(hits('angular-subscribe-leak', 'x.component.ts', component('    this.a$.pipe(\n      takeUntilDestroyed(this.destroyRef),\n    ).subscribe();'))).toEqual([]);
    expect(hits('angular-subscribe-leak', 'x.component.ts', component('    this.a$.pipe(take(1)).subscribe();'))).toEqual([]);
    expect(hits('angular-subscribe-leak', 'x.service.ts', 'export class S {\n  load() { this.http.get(u).subscribe(); }\n}')).toEqual([]);
  });

  it('unsafe-html: innerHTML, [innerHTML], bypassSecurityTrust and document.write', () => {
    expect(hits('unsafe-html', 'a.ts', 'el.innerHTML = html;\nel.textContent = text;\nthis.s.bypassSecurityTrustHtml(x);\n// el.innerHTML = x')).toEqual([1, 3]);
    expect(hits('unsafe-html', 'a.html', '<div [innerHTML]="bio"></div>\n<div>{{ bio }}</div>')).toEqual([1]);
  });

  it('img-alt: images without alt, including tags split over several lines', () => {
    expect(hits('img-alt', 'a.html', '<img src="a.png">\n<img src="b.png" alt="">\n<img\n  [src]="url"\n  class="x"\n/>\n<img [alt]="name" [src]="u">')).toEqual([1, 3]);
    expect(comment('img-alt', 'a.html', '<img src="a.png">')?.suggestion).toBe('<img alt="Describe the image" src="a.png">');
  });

  it('long-line: lines over 140 characters, except imports and JSON', () => {
    const long = 'const x = ' + '"a" + '.repeat(30) + '"b";';
    expect(hits('long-line', 'a.ts', `${long}\nconst y = 1;`)).toEqual([1]);
    expect(hits('long-line', 'a.ts', `import { ${'A, '.repeat(50)}B } from 'x';`)).toEqual([]);
    expect(hits('long-line', 'a.json', `{"a": "${'x'.repeat(200)}"}`)).toEqual([]);
  });

  it('long-function: functions whose visible body is over 40 lines', () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => `  step${i}();`).join('\n');
    expect(hits('long-function', 'a.ts', `function big() {\n${body(45)}\n}\nfunction small() {\n${body(3)}\n}`)).toEqual([1]);
    expect(hits('long-function', 'a.ts', `function ok() {\n${body(30)}\n}`)).toEqual([]);
    const py = `def big():\n${Array.from({ length: 45 }, (_, i) => `    x${i} = ${i}`).join('\n')}\n\ndef small():\n    pass`;
    expect(hits('long-function', 'a.py', py)).toEqual([1]);
  });

  it('magic-number: unexplained numbers in comparisons, arithmetic and timers, not named constants', () => {
    expect(hits('magic-number', 'a.ts', 'if (n > 25) {}\nsetTimeout(run, 3000);\nconst MAX_ITEMS = 25;\nif (n > 0) {}\nconst total = price * 1.08;')).toEqual([1, 2, 5]);
    expect(comment('magic-number', 'a.ts', 'if (n > 25) {}')?.title).toBe('Magic number 25');
    expect(hits('magic-number', 'a.spec.ts', 'expect(n > 25).toBeTrue();')).toEqual([]);
  });

  it('async-no-await: async functions that never await', () => {
    expect(hits('async-no-await', 'a.ts', 'async function a() {\n  return 1;\n}\nasync function b() {\n  return await c();\n}')).toEqual([1]);
    expect(hits('async-no-await', 'a.ts', 'const f = async (x) => {\n  for await (const y of x) {}\n};')).toEqual([]);
    expect(hits('async-no-await', 'a.py', 'async def a():\n    return 1\n\nasync def b():\n    await c()')).toEqual([1]);
  });

  it('no-var: var declarations, with a let suggestion', () => {
    expect(hits('no-var', 'a.js', 'var a = 1;\nlet b = 2;\nconst variable = 3;')).toEqual([1]);
    expect(comment('no-var', 'a.js', 'var a = 1;')?.suggestion).toBe('let a = 1;');
  });

  it('no-eval: eval, new Function and Python exec, but not regex.exec', () => {
    expect(hits('no-eval', 'a.js', 'eval(code);\nconst f = new Function("a", "b");\nre.exec(s);')).toEqual([1, 2]);
    expect(hits('no-eval', 'a.py', 'exec(code)\nmatch = pattern.exec(s)')).toEqual([1]);
  });

  it('bare-except: except: without an exception type', () => {
    expect(hits('bare-except', 'a.py', 'try:\n    a()\nexcept:\n    log()\nexcept ValueError:\n    pass')).toEqual([3]);
    expect(comment('bare-except', 'a.py', 'try:\n    a()\nexcept:\n    log()')?.suggestion).toBe('except Exception:');
  });

  it('focused-test and skipped-test', () => {
    expect(hits('focused-test', 'a.spec.ts', "fit('a', () => {});\nit.only('b', () => {});\nit('c', () => {});")).toEqual([1, 2]);
    expect(comment('focused-test', 'a.spec.ts', "fdescribe('a', () => {});")?.suggestion).toBe("describe('a', () => {});");
    expect(hits('skipped-test', 'a.spec.ts', "xit('a', () => {});\ndescribe.skip('b', () => {});")).toEqual([1, 2]);
    expect(hits('skipped-test', 'test_a.py', '@pytest.mark.skip(reason="x")\ndef test_a():\n    pass')).toEqual([1]);
  });

  it('tests-added: one praise comment for new test cases in test files only', () => {
    const praise = runRules(added('a.spec.ts', "it('a', () => {});\nit('b', () => {});")).filter((c) => c.severity === 'praise');
    expect(praise.length).toBe(1);
    expect(praise[0].body).toContain('2 test cases');
    expect(hits('tests-added', 'a.ts', "it('a', () => {});")).toEqual([]);
  });

  it('skips binary and deleted files', () => {
    const [png, gone] = parseUnifiedDiff(`diff --git a/a.png b/a.png
Binary files a/a.png and b/a.png differ
diff --git a/x.js b/x.js
deleted file mode 100644
--- a/x.js
+++ /dev/null
@@ -1 +0,0 @@
-debugger;
`).files;
    expect(runRules(png)).toEqual([]);
    expect(runRules(gone)).toEqual([]);
  });

  it('the bundled samples trigger every rule', () => {
    const fired = new Set(SAMPLES.flatMap((s) => parseUnifiedDiff(s.diff).files.flatMap((f) => runRules(f).map((c) => c.ruleId))));
    expect(RULES.map((r) => r.id).filter((id) => !fired.has(id))).toEqual([]);
  });
});
