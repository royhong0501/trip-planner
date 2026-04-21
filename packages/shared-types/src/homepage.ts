export interface HomepageSettingEntry<T = unknown> {
  key: string;
  value: T;
}

export type HomepageSettingKey =
  | 'site_name'
  | 'hero_slides'
  | 'video_intro';
