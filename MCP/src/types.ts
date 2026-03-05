export interface RemoteCallRequest {
  objectPath: string;
  functionName: string;
  parameters: Record<string, unknown>;
  generateTransaction: boolean;
}

export interface RemoteCallResponse {
  ReturnValue?: string;
  [key: string]: unknown;
}

export interface AssetInfo {
  path: string;
  name: string;
  class: string;
}
