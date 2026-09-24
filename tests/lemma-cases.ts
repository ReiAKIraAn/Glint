/**
 * 词形还原的用例表。测试和预览沙盒共用这一份。
 *
 * 之前两边各存一份，改了一处另一处不知道——而这张表的全部价值就在于「规则一旦
 * 越界就会剥出一个毫不相干的真词」，漂移了就等于没有。
 *
 * 「原型」不等于「词根」：happily / enormously 这种派生词在词典里有自己的词条和
 * 自己的中文释义，就该停在自己身上，不该被还原成 happy——否则释义是错的。
 * 只有屈折变化（复数、时态、比较级）才需要还原。
 */
export interface LemmaGroup {
  name: string;
  cases: [surface: string, lemma: string][];
}

export const LEMMA_GROUPS: LemmaGroup[] = [
  {
    name: '屈折变化要还原',
    cases: [
      ['receded', 'recede'],
      ['shimmered', 'shimmer'],
      ['accumulating', 'accumulate'],
      ['desiccated', 'desiccate'],
      ['convictions', 'conviction'],
      ['interlocutors', 'interlocutor'],
      ['accretes', 'accrete'],
      ['supplanted', 'supplant'],
      ['running', 'run'],
      ['bigger', 'big'],
      ['studies', 'study'],
    ],
  },
  {
    name: '不规则表兜底（规则怎么剥都剥不出来）',
    cases: [
      ['strata', 'stratum'],
      ['ran', 'run'],
      ['went', 'go'],
      ['children', 'child'],
      ['better', 'good'],
      ['saw', 'see'],
    ],
  },
  {
    name: '结尾像变形、其实是正常词——规则越界会剥出另一个真词',
    cases: [
      ['shimmer', 'shimmer'], // 别剥成 shim（垫片）
      ['ledger', 'ledger'], // 别剥成 ledge（岩架）
      ['sediment', 'sediment'],
      ['during', 'during'], // 别剥成 dur
      ['address', 'address'], // 别剥成 addres
      ['business', 'business'],
      ['scrutinize', 'scrutinize'],
      ['ubiquitous', 'ubiquitous'],
      ['happily', 'happily'], // 派生词，有独立词条，停在自己身上
    ],
  },
  {
    name: '-ing / -ed 去掉之后补不补 e（两个候选常常都是真词）',
    cases: [
      ['hoping', 'hope'], // 别剥成 hop
      ['writing', 'write'], // 别剥成 writ
      ['using', 'use'], // 别剥成 us
      ['being', 'be'], // 别剥成 bee
      ['singing', 'sing'], // 别剥成 singe
      ['reading', 'read'],
      ['postponing', 'postpone'], // 别剥成 postpon（ECDICT 里的垃圾词条）
    ],
  },
  {
    name: '缩写：不能一律按撇号切，don’t 切出的 don 是个真词',
    cases: [
      ["don't", 'do'],
      ["won't", 'will'],
      ["can't", 'can'],
      ["they're", 'they'],
      ["teachers'", 'teacher'],
      ["I'm", 'i'], // 剥完只剩一个字母，别当成生僻词
      ["it's", 'it'],
    ],
  },
];

export const LEMMA_CASES: [string, string][] = LEMMA_GROUPS.flatMap((g) => g.cases);
