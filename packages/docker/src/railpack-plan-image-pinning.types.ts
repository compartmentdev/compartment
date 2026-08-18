export interface RailpackPlanImagePinningInput {
  builder: string;
  runtime: string;
}

export type RailpackPlanJsonValue = boolean | null | number | RailpackPlanJsonObject | RailpackPlanJsonValue[] | string;

export interface RailpackPlanJsonObject {
  [key: string]: RailpackPlanJsonValue;
}

export type RailpackPlanInput = RailpackPlanJsonObject & {
  image?: string | undefined;
};

export type RailpackPlanStep = RailpackPlanJsonObject & {
  inputs?: RailpackPlanInput[] | undefined;
};

export type RailpackPlan = RailpackPlanJsonObject & {
  steps: RailpackPlanStep[];
};

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
