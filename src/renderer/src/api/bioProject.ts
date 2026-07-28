import { backendAPI, backendService } from "./backendService"
import { RAW_RESPONSE_STATUS_OK, RawResponse } from "./common"

export interface BioProject {
  pid: number
  projectName: string
  description: string
}

const mockBioProjects: BioProject[] = [
  {
    projectId: 1001,
    projectName: '肠道致病菌监测（第三批）',
    description: '对临床及环境来源的肠道致病菌开展全基因组测序、分型和耐药性分析。'
  },
  {
    projectId: 1002,
    projectName: '呼吸道病毒哨点监测',
    description: '针对哨点医院采集的呼吸道病毒样本开展全基因组分析和变异监测。'
  },
  {
    projectId: 1003,
    projectName: '院感菌株溯源分析',
    description: '通过菌株鉴定、MLST、耐药基因和核心基因组分析辅助院内感染溯源。'
  },
  {
    projectId: 1004,
    projectName: '食品来源沙门氏菌调查',
    description: '分析食品及加工环境来源沙门氏菌的血清型、耐药性和分子分型特征。'
  },
  {
    projectId: 1005,
    projectName: '新冠病毒变异株监测',
    description: '开展 SARS-CoV-2 全基因组组装、变异检测、谱系判定和 SNP 注释。'
  },
  {
    projectId: 1006,
    projectName: '多重耐药菌监测',
    description: '面向重点多重耐药菌开展物种鉴定、耐药基因和毒力因子分析。'
  },
  {
    projectId: 1007,
    projectName: '污水微生物宏基因组调查',
    description: '使用宏基因组鸟枪法分析污水样本中的微生物组成和物种丰度。'
  },
  {
    projectId: 1008,
    projectName: '动物肠道菌群 16S 调查',
    description: '通过 16S 扩增子测序分析动物肠道菌群结构及不同样本组间差异。'
  }
]


export async function requestCreateProject({
  projectName,
  description
}: {
  projectName: string
  description: string
}): Promise<RawResponse<number>> {
  return await backendService.post(backendAPI.createProject, {
    projectName: projectName,
    description: description
  });

  
}

export async function fetchProjectList(): Promise<RawResponse<BioProject[]>> {
  return await backendService.get(backendAPI.getAllProjects)
}
