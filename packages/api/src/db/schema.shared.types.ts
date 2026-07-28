import type {
  BuildColumns,
  BuildExtraConfigColumns,
  ColumnBuilderBase,
  ColumnBuilderBaseConfig,
  HasDefault,
  HasRuntimeDefault,
  IsPrimaryKey,
  NotNull,
} from 'drizzle-orm/column-builder';
import type {
  PgBigInt53BuilderInitial,
  PgBooleanBuilderInitial,
  PgIntegerBuilderInitial,
  PgTableWithColumns,
  PgTextBuilder,
  PgTimestampBuilderInitial,
} from 'drizzle-orm/pg-core';

interface TextBuilderConfig<TName extends string> extends ColumnBuilderBaseConfig<'string', 'PgText'> {
  name: TName;
  data: string;
  driverParam: string;
  enumValues: [string, ...string[]];
}

type TextBuilder<TName extends string> = PgTextBuilder<TextBuilderConfig<TName>>;
interface EnumTextBuilderConfig<
  TName extends string,
  TEnumValues extends [string, ...string[]],
> extends ColumnBuilderBaseConfig<'string', 'PgText'> {
  name: TName;
  data: EnumTextValue<TEnumValues>;
  driverParam: string;
  enumValues: TEnumValues;
}

type EnumTextBuilder<TName extends string, TEnumValues extends [string, ...string[]]> = PgTextBuilder<
  EnumTextBuilderConfig<TName, TEnumValues>
>;
type EnumTextValue<TEnumValues extends readonly string[]> = TEnumValues extends readonly [
  infer Head extends string,
  ...infer Tail extends readonly string[],
]
  ? Head | EnumTextValue<Tail>
  : never;
export type OptionalTextBuilder<TName extends string> = TextBuilder<TName>;
export type DefaultTextBuilder<TName extends string> = NotNull<HasDefault<TextBuilder<TName>>>;
export type RequiredTextBuilder<TName extends string> = NotNull<TextBuilder<TName>>;
export type RequiredEnumTextBuilder<TName extends string, TEnumValues extends [string, ...string[]]> = NotNull<
  EnumTextBuilder<TName, TEnumValues>
>;
export type DefaultEnumTextBuilder<TName extends string, TEnumValues extends [string, ...string[]]> = NotNull<
  HasDefault<EnumTextBuilder<TName, TEnumValues>>
>;
export type PrimaryTextBuilder<TName extends string> = IsPrimaryKey<NotNull<TextBuilder<TName>>>;
export type OptionalTimestampBuilder<TName extends string> = PgTimestampBuilderInitial<TName>;
export type RequiredTimestampBuilder<TName extends string> = NotNull<PgTimestampBuilderInitial<TName>>;
export type DefaultTimestampBuilder<TName extends string> = NotNull<HasDefault<PgTimestampBuilderInitial<TName>>>;
export type OptionalIntegerBuilder<TName extends string> = PgIntegerBuilderInitial<TName>;
export type RequiredIntegerBuilder<TName extends string> = NotNull<PgIntegerBuilderInitial<TName>>;
export type DefaultIntegerBuilder<TName extends string> = NotNull<HasDefault<PgIntegerBuilderInitial<TName>>>;
export type RuntimeDefaultIntegerBuilder<TName extends string> = NotNull<
  HasRuntimeDefault<HasDefault<PgIntegerBuilderInitial<TName>>>
>;
export type RequiredBigIntNumberBuilder<TName extends string> = NotNull<PgBigInt53BuilderInitial<TName>>;
export type RequiredBooleanBuilder<TName extends string> = NotNull<PgBooleanBuilderInitial<TName>>;
export type DefaultBooleanBuilder<TName extends string> = NotNull<HasDefault<PgBooleanBuilderInitial<TName>>>;

type PgColumnBuilderRecord<TColumnBuilders extends object> = TColumnBuilders &
  Record<keyof TColumnBuilders, ColumnBuilderBase>;

interface PgTableTypeConfig<TName extends string, TColumnBuilders extends object> {
  name: TName;
  schema: undefined;
  columns: BuildColumns<TName, PgColumnBuilderRecord<TColumnBuilders>, 'pg'>;
  dialect: 'pg';
}

export type PgTableOf<TName extends string, TColumnBuilders extends object> = PgTableWithColumns<
  PgTableTypeConfig<TName, TColumnBuilders>
>;

export type PgExtraConfigColumnsOf<TName extends string, TColumnBuilders extends object> = BuildExtraConfigColumns<
  TName,
  PgColumnBuilderRecord<TColumnBuilders>,
  'pg'
>;
