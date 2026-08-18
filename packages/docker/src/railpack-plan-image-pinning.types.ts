export type RailpackPlanJsonValue = boolean | null | number | RailpackPlanJsonObject | RailpackPlanJsonValue[] | string;

export interface RailpackPlanJsonObject {
  [key: string]: RailpackPlanJsonValue;
}

export interface RailpackPlanInput extends RailpackPlanJsonObject {
  image?: string;
}

export interface RailpackPlanStep extends RailpackPlanJsonObject {
  inputs?: RailpackPlanInput[];
}

export interface RailpackPlan extends RailpackPlanJsonObject {
  steps: RailpackPlanStep[];
}

export interface RailpackPinnedImageCounts {
  builder: number;
  runtime: number;
}

export interface RailpackPinnedImage {
  pinned: string;
  repository: string;
  tagged: string;
}

export interface RailpackResolvedImages {
  builder: RailpackPinnedImage;
  runtime: RailpackPinnedImage;
}
