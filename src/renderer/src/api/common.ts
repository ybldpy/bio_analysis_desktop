export interface RawResponse<T> {
    status: number 
    data: T
    failMsg: string
}

export const RAW_RESPONSE_STATUS_OK = 0
export const RAW_RESPONSE_STATUS_DUPLICATE_OPERATION =3
export const RAW_RESPONSE_STATUS_BUSINESS_FAIL = 1
export const RAW_RESPONSE_STATUS_INTERNAL_FAIL = 2


const domain = 'http://wsl.dev:8080'

