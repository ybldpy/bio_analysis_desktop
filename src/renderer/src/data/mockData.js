export const projects = [
  {
    id: 'PRJ-2026-018',
    name: '肠道致病菌监测（第三批）',
    description: '2026 年夏季肠道致病菌常规监测样本',
    samples: 36,
    tasks: 28,
    status: '进行中',
    owner: '微生物组',
    createdAt: '2026-07-18'
  },
  {
    id: 'PRJ-2026-017',
    name: '呼吸道病毒哨点监测',
    description: '流感与呼吸道病毒全基因组测序分析',
    samples: 48,
    tasks: 48,
    status: '进行中',
    owner: '病毒组',
    createdAt: '2026-07-12'
  },
  {
    id: 'PRJ-2026-014',
    name: '院感菌株溯源分析',
    description: '多重耐药菌株的分型与 SNP 聚类',
    samples: 22,
    tasks: 20,
    status: '已完成',
    owner: '细菌组',
    createdAt: '2026-06-26'
  },
  {
    id: 'PRJ-2026-011',
    name: '食品来源沙门氏菌调查',
    description: '食品分离株血清型、耐药与毒力分析',
    samples: 64,
    tasks: 61,
    status: '已归档',
    owner: '食品安全组',
    createdAt: '2026-05-08'
  }
]

export const tasks = [
  {
    id: 'TASK-0721-008',
    name: 'EC-20260721-08',
    sample: 'EC-20260721-08',
    project: '肠道致病菌监测（第三批）',
    type: '细菌全基因组',
    input: '双端 FASTQ',
    status: '运行中',
    progress: 68,
    stage: '物种鉴定',
    createdAt: '今天 14:32',
    duration: '00:23:48'
  },
  {
    id: 'TASK-0721-007',
    name: 'FLU-A-240721-03',
    sample: 'FLU-A-240721-03',
    project: '呼吸道病毒哨点监测',
    type: '病毒全基因组',
    input: '双端 FASTQ',
    status: '需要确认',
    progress: 52,
    stage: '参考基因组确认',
    createdAt: '今天 13:18',
    duration: '00:18:12'
  },
  {
    id: 'TASK-0721-006',
    name: 'KP-ICU-0719-12',
    sample: 'KP-ICU-0719-12',
    project: '院感菌株溯源分析',
    type: '细菌全基因组',
    input: 'Contigs FASTA',
    status: '已完成',
    progress: 100,
    stage: '报告生成',
    createdAt: '今天 11:46',
    duration: '00:41:06'
  },
  {
    id: 'TASK-0721-005',
    name: 'SAL-FD-0718-21',
    sample: 'SAL-FD-0718-21',
    project: '食品来源沙门氏菌调查',
    type: '细菌全基因组',
    input: '双端 FASTQ',
    status: '已完成',
    progress: 100,
    stage: '报告生成',
    createdAt: '今天 10:15',
    duration: '01:06:22'
  },
  {
    id: 'TASK-0720-031',
    name: 'NV-GII-0720-05',
    sample: 'NV-GII-0720-05',
    project: '呼吸道病毒哨点监测',
    type: '病毒全基因组',
    input: '单端 FASTQ',
    status: '失败',
    progress: 34,
    stage: 'Reads 比对',
    createdAt: '昨天 18:42',
    duration: '00:09:35'
  },
  {
    id: 'TASK-0720-029',
    name: 'AB-ICU-0720-02',
    sample: 'AB-ICU-0720-02',
    project: '院感菌株溯源分析',
    type: 'SNP 联合分析',
    input: '12 个样本',
    status: '等待中',
    progress: 0,
    stage: '队列等待',
    createdAt: '昨天 17:03',
    duration: '--'
  }
]

export const pipelineNodes = [
  {
    id: 'preprocess',
    name: '数据预处理',
    status: 'completed',
    duration: '2m 18s',
    summary: '完成文件完整性与双端配对检查',
    output: 'clean_manifest.json'
  },
  {
    id: 'qc',
    name: '数据质控',
    status: 'completed',
    duration: '8m 42s',
    summary: 'Q30 94.7%，过滤后 Reads 6,824,310',
    output: 'fastp_report.html'
  },
  {
    id: 'assembly',
    name: '无参组装',
    status: 'completed',
    duration: '11m 05s',
    summary: '总长度 5.12 Mb，N50 186,420 bp',
    output: 'contigs.fasta'
  },
  {
    id: 'species',
    name: '物种鉴定',
    status: 'running',
    duration: '1m 43s',
    summary: '正在计算候选物种及 ANI 结果',
    output: '--'
  },
  {
    id: 'amr',
    name: '耐药基因',
    status: 'pending',
    duration: '--',
    summary: '等待无参组装结果',
    output: '--'
  },
  {
    id: 'virulence',
    name: '毒力因子',
    status: 'pending',
    duration: '--',
    summary: '等待无参组装结果',
    output: '--'
  },
  {
    id: 'mlst',
    name: 'MLST',
    status: 'pending',
    duration: '--',
    summary: '等待无参组装结果',
    output: '--'
  },
  {
    id: 'cgmlst',
    name: 'cgMLST',
    status: 'pending',
    duration: '--',
    summary: '等待物种鉴定结果',
    output: '--'
  },
  {
    id: 'serotype',
    name: '血清型',
    status: 'pending',
    duration: '--',
    summary: '等待物种鉴定结果',
    output: '--'
  },
  {
    id: 'report',
    name: '报告生成',
    status: 'pending',
    duration: '--',
    summary: '等待所有分析模块完成',
    output: '--'
  }
]

export const resultFiles = [
  {
    name: 'fastp_report.html',
    stage: '数据质控',
    type: 'HTML',
    size: '1.8 MB',
    updatedAt: '今天 14:38'
  },
  {
    name: 'clean_R1.fastq.gz',
    stage: '数据质控',
    type: 'FASTQ',
    size: '684 MB',
    updatedAt: '今天 14:38'
  },
  {
    name: 'clean_R2.fastq.gz',
    stage: '数据质控',
    type: 'FASTQ',
    size: '701 MB',
    updatedAt: '今天 14:38'
  },
  {
    name: 'contigs.fasta',
    stage: '无参组装',
    type: 'FASTA',
    size: '5.2 MB',
    updatedAt: '今天 14:49'
  },
  {
    name: 'assembly_stats.tsv',
    stage: '无参组装',
    type: 'TSV',
    size: '4 KB',
    updatedAt: '今天 14:49'
  }
]
