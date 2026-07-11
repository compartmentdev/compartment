export type GitLabJsonPrimitive = boolean | null | number | string;
export type GitLabJsonValue = GitLabJsonObject | GitLabJsonPrimitive | GitLabJsonValue[];
export interface GitLabJsonObject {
  [key: string]: GitLabJsonValue;
}

export interface GitLabRequestInput {
  body?: GitLabJsonValue;
  method?: 'DELETE' | 'GET' | 'POST';
  path: string;
  query?: Readonly<Record<string, boolean | number | string>>;
}

export interface GitLabClientInput {
  providerHost: string;
  token: string;
}
