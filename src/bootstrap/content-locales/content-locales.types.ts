export enum ContentLocaleCode {
  English = 'en',
  Vietnamese = 'vi',
}

export type ContentLocaleDefinition = Readonly<{
  code: ContentLocaleCode;
  name: string;
  isDefault?: boolean;
}>;

export const getManagedContentLocales = (): readonly ContentLocaleDefinition[] => [
  {
    code: ContentLocaleCode.Vietnamese,
    name: 'Vietnamese (vi)',
    isDefault: true,
  },
  {
    code: ContentLocaleCode.English,
    name: 'English (en)',
  },
];
