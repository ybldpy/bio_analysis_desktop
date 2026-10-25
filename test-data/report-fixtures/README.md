# P4 报告测试夹具

来源：`pipeline-report-examples.md` 指定的既有真实工具产物，2026-10-21 通过 WSL 只读核实。

- QC JSON 仅摘录原报告的 `summary`、`filtering_result`，数值未改；不是完整报告。
- TSV 保留全部表头和数据行。VF 和 MLST 的输入路径已替换为文件名；换行统一为 LF。
- 未复制 QC 的 `command`、曲线或 k-mer 明细，也没有运行分析工具。
- 夹具仅用于既有报告的解析/渲染回归测试，业务代码不得引用这些本地路径。
- 各测试中另构造的缺字段、错误及边界数据属于合成测试，不作为真实格式的证明。

后端项目内的原相对路径：

- `qc-short.json` ← `target/final-pipeline-regression-YhRGovlP/rerun-SKvX7IkL/bacteria-attempt2/run-5473726166793917219/ecoli_mg1655_SRR1030394/storage/stageOutput/102/cleaned.json`
- `qc-long.json` ← `target/qc-public-data-regression/run-14386567059686433537/bacteria_flye_ecoli_corrected/storage/stageOutput/2/qc.json`
- `amr.tsv` ← `target/final-pipeline-regression-YhRGovlP/rerun-SKvX7IkL/bacteria-attempt2/run-5473726166793917219/ecoli_mg1655_SRR1030394/storage/stageOutput/105/amr.tsv`
- `vf.tsv` ← `target/final-pipeline-regression-YhRGovlP/rerun-SKvX7IkL/bacteria-attempt2/run-5473726166793917219/ecoli_mg1655_SRR1030394/storage/stageOutput/106/vf.tsv`
- `mlst.tsv` ← `target/final-pipeline-regression-YhRGovlP/rerun-SKvX7IkL/bacteria-attempt2/run-5473726166793917219/ecoli_mg1655_SRR1030394/storage/stageOutput/107/mlst.tsv`
- `ectyper.tsv` ← `target/final-pipeline-regression-YhRGovlP/rerun-SKvX7IkL/bacteria-attempt2/run-5473726166793917219/ecoli_mg1655_SRR1030394/storage/stageOutput/108/serotypeResult.tsv`
- `amr-empty.tsv` ← `target/final-pipeline-regression-YhRGovlP/rerun-SKvX7IkL/bacteria-attempt2/run-5473726166793917219/cglutamicum_DRR119686/storage/stageOutput/205/amr.tsv`
- `vf-empty.tsv` ← `target/final-pipeline-regression-YhRGovlP/rerun-SKvX7IkL/bacteria-attempt2/run-5473726166793917219/cglutamicum_DRR119686/storage/stageOutput/206/vf.tsv`
- `mlst-untyped.tsv` ← `target/final-pipeline-regression-YhRGovlP/rerun-SKvX7IkL/bacteria-attempt2/run-5473726166793917219/cglutamicum_DRR119686/storage/stageOutput/207/mlst.tsv`

