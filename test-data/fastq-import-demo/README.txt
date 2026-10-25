批量文件导入演示

在“创建分析任务”页面点击“选择目录”，选择 fastq-import-demo 目录。
从初始的单个空任务开始，预期生成 5 个任务：3 个双端、2 个单端；忽略 1 个非 FASTQ 文件（本说明文件），另忽略子目录中的 2 个文件。
已有任务包含文件时，新任务会追加到任务列表。

双端示例：
1. demoA_R1.fastq + demoA_R2.fastq
2. demoB_1.fq + demoB_2.fq
3. demoC_S1_L001_R1_001.fastq + demoC_S1_L001_R2_001.fastq

单端示例：
1. orphan_R2.fastq：只有 R2，作为单端文件。
2. single.fastq：没有配对标记，作为单端文件。
batch-a/shared_R1.fastq 和 batch-b/shared_R2.fastq 位于子目录，本次不会导入。
如需导入其中的文件，应直接选择 batch-a 或 batch-b 目录。

也可以点击“多选文件”，只选本目录中的 8 个 FASTQ/FQ 文件：应生成 3 个双端和 2 个单端任务。

这些是人工生成的极小格式样例，仅用于测试文件选择、配对、任务生成和文件名显示，不用于真实生物分析。
