文件名匹配测试数据

仅用于前端文件选择、目录导入、自动配对和任务列表展示。
每个 FASTQ 只有两条人工重复字符记录，不是任何物种的真实数据，不用于分析正确性测试。
扩展名为 .gz 的文件经过实际 gzip 压缩，不是只改文件名。

建议每次在新的空批次中测试，避免重复追加任务干扰计数。
目录导入只处理所选目录的直属文件，所有子目录中的文件均忽略。

1. 01-basic-multi-select
   多选其中全部 11 个 FASTQ/FQ 文件：预期 7 个任务 = 4 双端 + 3 单端。
   或选择整个文件夹：同样 7 个任务，另忽略 2 个非 FASTQ 文件。
   双端：sampleA_R1/R2、sampleB_1/2、sampleC_R1_001/R2_001、sampleD.R1/R2。
   单端：single_reads、orphanA_R1、orphanB_R2。

2. 02-directory
   选择 02-directory：预期 0 个任务，忽略子目录中的 6 个文件。
   直接选择 run_a 或 run_b：各生成 1 个双端任务。
   直接选择 split_a 或 split_b：各生成 1 个单端任务。

3. 03-edge-cases
   选择 03-edge-cases：预期 0 个任务，忽略直属 ignore.fasta 和子目录中的 13 个文件。
   分别直接选择以下叶子目录测试：
   lanes：2 个双端，L001、L002 各自成对，不能合并 lane。
   chunks：2 个单端，chunk_R1_001 与 chunk_R2_002 的 chunk 不同。
   ambiguous：3 个单端，并提示 3 个配对歧义文件，不随机挑选。
   uppercase：1 个双端，大写扩展名仍可识别。
   mixed-marker：2 个单端，mixed_R1 与 mixed_2 命名规则不同。

选择整个 fastq-filename-check 根目录：预期 0 个任务。
该层只有本说明文件；子目录中的 33 个文件全部忽略，不递归导入。

注意：配对仅发生在本次选取的文件之间，不会自动与之前已导入任务的文件补配。
“多选文件”行为不变；目录测试应直接选含有待测试文件的那一层。
