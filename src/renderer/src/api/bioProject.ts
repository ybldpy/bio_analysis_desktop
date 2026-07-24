export interface BioProject {
  projectId: number
  projectName: string
}

const mockBioProjects: BioProject[] = [
  {
    projectId: 1001,
    projectName: '肠道致病菌监测（第三批）'
  },
  {
    projectId: 1002,
    projectName: '呼吸道病毒哨点监测'
  },
  {
    projectId: 1003,
    projectName: '院感菌株溯源分析'
  },
  {
    projectId: 1004,
    projectName: '食品来源沙门氏菌调查'
  }
]

export async function fetchProjectList(): Promise<BioProject[]> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 500)
  })

  return mockBioProjects
}
